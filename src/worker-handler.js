/** ******************************************************************************************************************
 * @file Describe what worker-handler does.
 * @author Julian Jensen <jjdanois@gmail.com>
 * @since 1.0.0
 * @date 19-Jul-2020
 *********************************************************************************************************************/
"use strict";

async function expose( ...things )
{
    async function workerChannels()
    {
        const { parentPort }   = await import( 'worker_threads' );
        return {
            postMessage: ( value, transferList ) => parentPort.postMessage( value, transferList ),
            onmessage: fn => parentPort.on( 'message', fn )
        };
    }

    const
        isNode = typeof _.process?.node === 'string' && typeof _.process?.v8 === 'string',
        { postMessage, onmessage } = isNode ?
            await workerChannels() :
            { postMessage: window.postMessage, onmessage: fn => window.onmessage = fn },

        exposed = [],

        { keys, getOwnPropertyDescriptors: ownProps, getOwnPropertySymbols: ownSyms } = Object,
        { toString: toStr, hasOwnProperty: prop } = {},
        has       = ( o, k ) => prop.call( o, k ),
        toString  = target => toStr.call( target ),
        typeName  = o => ( _ => _.substr( 0, _.length - 1 ) )( toString( o ).substring( 8 ) ),

        send      = msg => postMessage( msg, void 0 ),
        withInvocation = invocation => result => send({ invocation, result }),

        props     = o => keys( ownProps( o ) ).concat( ownSyms( o ) ),
        funcNames = props( function() {}),
        funcType  = m => !m.includes( 'prototype' ) ? 'arrowFunction' : m.includes( 'arguments' ) ? 'function' : 'class',
        subtract  = ( s1, s2 ) => [ ...s2.reduce( ( res, nm ) => ( res.delete( nm ), res ), new Set( s1 ) ) ],
        punt = msg => { throw new Error( msg ); };

    things
        .map( typeName )
        .forEach( t => t !== 'Function' && t !== 'Object' && punt( `Thread objects must be functions, classes, or objects, received: ${t}` ) );

    function members( t, thing )
    {
        const p = props( thing );

        return {
            __$type: t === 'Function' ? funcType( p ) : null,
            __$members:  subtract( p, funcNames ).map( n => ({
                name: n,
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

    const couldExpose = ( invocation, item ) => {
        const t = typeName( item );

        if ( t === 'Function' || t === 'Object' )
            send({ invocation, exposed: makeList( [ item ] ) });
        else
            send({ invocation, result: item });
    };

    onmessage( async ({ data: { exposedIndex = 0, invocation, path, action, args = [] } }) => {
        try
        {
            const
                post = withInvocation( invocation ),
                get = () => path.reduce( ( base, part ) => base ?? base[ part ], exposed[ exposedIndex ] ),
                key = path.length > 0 ? path.pop() : null,
                base = path.length > 0 ? get() : exposed[ exposedIndex ];

            ({
                write() { post( base[ key ] = args[ 0 ] ); },
                read() { couldExpose( base[ key ] ); },
                has() { post( has( base, key ) ); },
                construct() { couldExpose( key ? new base[ key ]( ...args ) : new base( ...args ) ); },
                async call() { couldExpose( await ( key ? base[ key ]( ...args ) : base( ...args ) ) ); },
                destroy() { exposed[ args[ 0 ] ] = null; }
            })[ action ]();
        }
        catch ( e )
        {
            send({ invocation, error: { type: e.constructor.name, message: e.message, stack: e.stack } });
        }
    });

    send({ exposed: makeList( things ) });
}

export default expose;
