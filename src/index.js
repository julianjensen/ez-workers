/** ******************************************************************************************************************
 * @file Worker manager.
 * @author Julian Jensen <jjdanois@gmail.com>
 * @since 1.0.0
 * @date 19-Jul-2020
 *********************************************************************************************************************/
"use strict";

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
        isNode = typeof _.process?.node === 'string' && typeof _.process?.v8 === 'string',
        { EventEmitter } = await import( isNode ? 'events' : '../event-emitter-14.6/events.js' ),
        createWorker = isNode ? nodeCreateWorker : browserCreateWorker,
        thread = await createWorker( workerFile ),
        events = new EventEmitter(),
        markForRemoval = destroyer( index => thread.postMessage({ action: 'destroy', exposedIndex: index }) );

    events.setMaxListeners( 100 );

    let resolve, invocationNumber = 0;

    const
        promise = new Promise( r => resolve = r ),
        request = ( path, action, threadIndex, ...args ) => new Promise( ( resolve, reject ) => {
            thread.postMessage({ invocation: ++invocationNumber, path, action, threadIndex, args });
            events.once( invocationNumber, ({ result, error }) => error ? reject( error ) : resolve( result ) );
        });

    function makeHandler( target )
    {
        const p = new Proxy( typeof target === 'function' ? function() {} : {}, {
            apply: ( target, thisArg, args ) => request( null, 'call', target.__$threadIndex, args ),
            construct: ( target, args ) => request( null, 'construct', target.__$threadIndex, args ),
            get: ( target, prop ) => request( [ prop ], 'read', target.__$threadIndex ),
            has: ( target, prop ) => request( [ prop ], 'has', target.__$threadIndex ),
            set: ( target, prop, value ) => request( [ prop ], 'write', target.__$threadIndex, value )
        });

        markForRemoval( p, target.__$threadIndex );

        return p;
    }

    thread.onmessage = ({ data: { invocation, result, error, exposed } }) => {
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
            this.emit( invocation, { result });
    };

    return promise;
}
