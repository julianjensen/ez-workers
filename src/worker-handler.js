/** ******************************************************************************************************************
 * @file Describe what worker-handler does.
 * @author Julian Jensen <jjdanois@gmail.com>
 * @since 1.0.0
 * @date 19-Jul-2020
 *********************************************************************************************************************/
"use strict";

const
    DEBUG = false,
    log = ( ...args ) => DEBUG && console.log( `[WORKER]:`, ...args );

export default async function expose( ...things )
{
    async function workerChannels()
    {
        const { parentPort, isMainThread }   = await import( 'worker_threads' );
        return {
            postMessage: ( value, transferList ) => parentPort.postMessage( value, transferList ),
            onmessage: fn => parentPort.on( 'message', fn ),
            isMainThread
        };
    }

    const
        isNode = typeof process !== 'undefined' && typeof process.nextTick === 'function' && typeof process.versions === 'object',
        { postMessage, onmessage, isMainThread } = isNode ?
            await workerChannels() :
            { postMessage: window.postMessage, onmessage: fn => window.onmessage = fn, isMainThread: false },
        exposed = [];

    if ( isNode && isMainThread ) return;

    const
        { keys, getOwnPropertyDescriptors: ownProps, getOwnPropertySymbols: ownSyms } = Object,
        { toString: toStr, hasOwnProperty: prop } = {},
        has       = ( o, k ) => prop.call( o, k ),
        toString  = target => toStr.call( target ),
        typeName  = o => ( _ => _.substr( 0, _.length - 1 ) )( toString( o ).substring( 8 ) ),
        asArray = a => Array.isArray( a ) ? a : a != null ? [ a ] : [],

        send      = msg => postMessage( msg, void 0 ),
        withInvocation = invocation => result => send({ invocation, result }),
        symToText = s => typeof s === 'symbol' ? String(s) : s,
        textToSym = s => {
            if ( typeof s !== 'string' ) return s;
            const [ , name ] = s.match( /^Symbol\(Symbol\.([a-zA-Z]+)\)$/ ) || [];
            return name ? Symbol[ name ] : s;
        },

        props     = o => keys( ownProps( o ) ).concat( ownSyms( o ) ),
        funcNames = props( function() {}),
        funcType  = m => !m.includes( 'prototype' ) ? 'arrowFunction' : m.includes( 'arguments' ) ? 'function' : 'class',
        subtract  = ( s1, s2 ) => [ ...s2.reduce( ( res, nm ) => ( res.delete( nm ), res ), new Set( s1 ) ) ],
        punt = msg => { throw new Error( msg ); },
        xError = e => ( {
            type:    e.constructor.name,
            message: e.message,
            stack:   e.stack
        });

    things
        .map( typeName )
        .forEach( t => t !== 'Function' && t !== 'Object' && punt( `Thread objects must be functions, classes, or objects, received: ${t}` ) );

    function members( t, thing )
    {
        const p = props( thing );

        return {
            __$type: t === 'Function' ? funcType( p ) : null,
            __$name: thing.name,
            __$members:  subtract( p, funcNames ).map( n => ({
                name: symToText( n ),
                type: typeName( thing[ n ] )
            }) )
        };
    }

    const makeList = toExpose => toExpose.map( item => {
        exposed.push( item );
        return {
            __$threadIndex: exposed.length - 1,
            __$name: item.name || item.constructor.name,
            ...members( typeName( item ), item )
        };
    });

    const couldExpose = invocation => item => {
        const t = typeName( item );

        log( `sending( ${invocation}, ${item}: ${t} )` );

        if ( t === 'Function' || t === 'Object' )
            send({ invocation, exposed: makeList( [ item ] ) });
        else
            send({ invocation, result: item });
    };

    onmessage( async ({ exposedIndex = 0, invocation, path, action, args = [] }) => {
        try
        {
            path = asArray( path );

            const
                post = withInvocation( invocation ),
                get = () => path.reduce( ( base, part ) => base ?? base[ textToSym( part ) ], exposed[ exposedIndex ] ),
                key = textToSym( path.length > 0 ? path.pop() : null ),
                base = path.length > 0 ? get() : exposed[ exposedIndex ],
                pack = couldExpose( invocation );

            ({
                write() { post( base[ key ] = args[ 0 ] ); },
                read() {
                    if ( key !== 'then' ) log( `worker read "${symToText( key )}" = ${base[ key ]} on`, base[ key ] );
                    pack( base[ key ] );
                },
                has() { post( has( base, key ) ); },
                construct() { pack( key ? new base[ key ]( ...args ) : new base( ...args ) ); },
                async call() {
                    try
                    {
                        log( `Calling "${key}" with args(${args.length}):`, args );
                        const x = await ( key ? base[ key ]( ...args ) : base( ...args ) );
                        pack( x );
                    }
                    catch ( e )
                    {
                        console.error( e );
                        send({ invocation, error: xError( e ) });
                    }
                },
                destroy() { {
                    log( `Destroying thread, removing ref to exposed object: ${exposedIndex}` );
                    exposed[ exposedIndex ] = null;
                    post( null );
                } }
            })[ action ]();
        }
        catch ( e )
        {
            send({ invocation, error: xError( e ) });
        }
    });

    send({ exposed: makeList( things ) });
}
