/** ******************************************************************************************************************
 * @file Worker manager.
 * @author Julian Jensen <jjdanois@gmail.com>
 * @since 1.0.0
 * @date 19-Jul-2020
 *********************************************************************************************************************/
"use strict";

const
    DEBUG = false,
    log = ( ...args ) => DEBUG && console.log( `[MAIN]:`, ...args );

async function nodeCreateWorker( path )
{
    const { Worker } = await import( 'worker_threads' );

    class WrappedWorker extends Worker
    {
        constructor( ...args )
        {
            super( ...args );
            this.onmessage = x => x;
            this.on( 'message', data => this.onmessage( data ) );
        }
    }

    const worker = new WrappedWorker( path );
    worker.setMaxListeners( 100 );
    return worker;
}

const browserCreateWorker = path => new Worker( path );

function destroyer( release )
{
    const registry = new FinalizationRegistry( index => release( index ) );

    return ( thing, index ) => registry.register( thing, index );
}

export default async function wrap( workerFile )
{
    const
        hasFinalization = typeof FinalizationRegistry !== 'undefined',
        isNode = typeof process !== 'undefined' && typeof process.nextTick === 'function' && typeof process.versions === 'object',
        { EventEmitter } = await import( isNode ? 'events' : './events.js' ),
        createWorker = isNode ? nodeCreateWorker : browserCreateWorker,
        thread = await createWorker( workerFile ),
        events = new EventEmitter(),
        markForRemoval = hasFinalization && destroyer( index => thread.postMessage({ action: 'destroy', exposedIndex: index }) ),
        make = {
            function: name => ( { [ name ]: function() {} }[ name ] ),
            class: name => ( { [ name ]: class {} }[ name ] ),
            arrowFunction: name => ( { [ name ]: () => {} }[ name ] )
        };

    events.setMaxListeners( 100 );

    let resolve, invocationNumber = 0, inFlight = new Set();

    const
        promise = new Promise( r => resolve = r ),
        request = ( path, action, threadIndex, args ) =>
            new Promise( ( resolve, reject ) => {
                inFlight.add( reject );
                thread.postMessage({ invocation: ++invocationNumber, path, action, threadIndex, args });
                events.once( invocationNumber, data => {
                    inFlight.delete( reject );
                    const { result, error } = data;
                    log( 'data from once:', data );
                    error ? reject( error ) : resolve( result );
                } );
            })
            .catch( console.error ),
        flush = () => new Promise( resolve => {
            let abort = false;
            let waitHandle;
            const handle = setTimeout( () => {
                abort   = true;
                const e = new Error( `Timeout on worker thread` );
                clearTimeout( waitHandle );
                [ ...inFlight ].forEach( r => r( e ) );
                inFlight.clear();
            } );
            const check = () => {
                if ( inFlight.size === 0 || abort ) {
                    clearTimeout( handle );
                    resolve();
                }
                else
                    waitHandle = setTimeout( check, 2000 );
            }
            check();
        });

    function makeHandler( target )
    {
        const members = target.__$members.reduce( ( lu, { name, type } ) => ({ ...lu, [ name ]: type }), {} );

        const p = new Proxy( make[ target.__$type ]?.( target.__$name ) ?? {}, {
            apply: ( target, thisArg, args ) => request( null, 'call', target.__$threadIndex, args ),
            construct: ( target, args ) => request( null, 'construct', target.__$threadIndex, args ),
            get: ( target, prop ) => {
                const type = members[ prop ];

                if ( type === 'Function' )
                    return ( ...args ) => request( [ String( prop ) ], 'call', target.__$threadIndex, args );

                if ( type == null && prop === 'terminate' )
                    return () => request( [], 'destroy', target.__$threadIndex )
                        .then( () => inFlight.size === 0 ? thread.terminate() : flush() );

                if ( prop === 'name' ) return target.name;
                return request( [ String( prop ) ], 'read', target.__$threadIndex )
            },
            has: ( target, prop ) => request( [ String( prop ) ], 'has', target.__$threadIndex ),
            set: ( target, prop, value ) => request( [ String( prop ) ], 'write', target.__$threadIndex, value )
        });

        if ( hasFinalization )
            markForRemoval( p, target.__$threadIndex );

        return p;
    }

    thread.onmessage = ( { invocation, result, error, exposed }) => {
        log( `received inv: ${invocation}, result: ${result}, error: ${!!error}, exposed: ${!!exposed}` );
        if ( exposed ) {
            const toExpose = exposed.length === 1 ? makeHandler( exposed[ 0 ] ) : exposed.map( makeHandler );
            if ( !invocation )
                resolve( toExpose );
            else
                events.emit( invocation, { result: toExpose });
        }
        else if ( error != null )
            events.emit( invocation, { error: { ...new globalThis[ error.type ]( error.message ), stack: error.stack } });
        else
            events.emit( invocation, { result });
    };

    return promise;
}
