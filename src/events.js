// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

const kRejection = Symbol.for( 'nodejs.rejection' );
const isString = s => typeof s === 'string';
const { defineProperty: define } = Object;

// As of V8 6.6, depending on the size of the array, this is anywhere between 1.5-10x faster than
// the two-arg version of Array#splice()
function spliceOne( list, index )
{
    for ( ; index + 1 < list.length; index++ ) list[ index ] = list[ index + 1 ];
    list.pop();
}

function oneOf( expected, thing )
{
    if ( Array.isArray( expected ) )
    {
        const len = ( expected = expected.map( i => String( i ) ) ).length;

        if ( len > 2 )
            return `one of ${thing} ${expected.slice( 0, len - 1 ).join( ', ' )}, or ` + expected[ len - 1 ];
        else if ( len === 2 )
            return `one of ${thing} ${expected[ 0 ]} or ${expected[ 1 ]}`;

        return `of ${thing} ${expected[ 0 ]}`;
    }
    else
        return `of ${thing} ${String( expected )}`;
}

function typeErrorMessage( name, expected, actual ) {

    let determiner,
        msg;

    if ( isString( expected ) && expected.startsWith( 'not ' ) )
    {
        determiner = 'must not be';
        expected   = expected.substr( 4 );
    }
    else determiner = 'must be';

    if ( name.endsWith( ' argument' ) ) // For cases like 'first argument'
        msg = `The ${name} ${determiner} ${oneOf( expected, 'type' )}`; else { msg =
            `The "${name}" ${name.includes( '.' ) ? 'property' : 'argument'} ${determiner} ${oneOf( expected, 'type' )}`; }

    return msg + `. Received type ${typeof actual}`;
}

function rangeErrorMessage( str, range, input, replaceDefaultBoolean = false ) {
    let msg = replaceDefaultBoolean ? str : `The value of "${str}" is out of range.`;
    return msg +
            ` It must be ${range}. Received ${typeof input === 'string' ? `'${String( input )}'` : String( input )}`;
}

function unhandledErrorMessage( err = void 0 ) {
    const msg = 'Unhandled error.';
    return err === undefined ? msg : `${msg} (${err})`;
}

const
    ERR_OUT_OF_RANGE = makeErrorWithCode( RangeError, "ERR_OUT_OF_RANGE", args => rangeErrorMessage( ...args ) ),
    ERR_INVALID_ARG_TYPE = makeErrorWithCode( TypeError, "ERR_INVALID_ARG_TYPE", args => typeErrorMessage( ...args ) ),
    ERR_UNHANDLED_ERROR = makeErrorWithCode( Error, "ERR_UNHANDLED_ERROR", args => unhandledErrorMessage( ...args ) );

function addCodeToName( err, name, code )
{
    err.name = `${name} [${code}]`;
    err.stack; // Access the stack to generate the error message including the error code from the name.
    delete err.name;
}

/**
     * @param {ErrorConstructor|RangeErrorConstructor|TypeErrorConstructor} Base
     * @param {string} key
     * @param {function} getMessage
     * @return {{new(...[*]=): EventError, code: *, prototype: EventError}}
     */
function makeErrorWithCode( Base, key, getMessage )
{
    return class EventError extends Base
    {
        constructor( ...args )
        {
            super();

            const message = getMessage( args );
            define( this, 'message', { value: message, enumerable: false, writable: true, configurable: true });
            addCodeToName( this, super.name, key );
            this.code = key;
        }

        toString()
        {
            return `${this.name} [${key}]: ${this.message}`;
        }
    };
}

const kCapture      = Symbol( 'kCapture' );
const kErrorMonitor = Symbol( 'events.errorMonitor' );

function EventEmitter( opts )
{
    EventEmitter.init.call( this, opts );
}

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.usingDomains = false;

EventEmitter.captureRejectionSymbol = kRejection;
define( EventEmitter, 'captureRejections', {
    get() { return EventEmitter.prototype[ kCapture ]; },
    set( value )
    {
        if ( typeof value !== 'boolean' )  throw new ERR_INVALID_ARG_TYPE( 'EventEmitter.captureRejections', 'boolean', value );
        EventEmitter.prototype[ kCapture ] = value;
    },
    enumerable: true
});

EventEmitter.errorMonitor = kErrorMonitor;

// The default for captureRejections is false
define( EventEmitter.prototype, kCapture, { value: false, writable: true, enumerable: false });

EventEmitter.prototype._events       = undefined;
EventEmitter.prototype._eventsCount  = 0;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
let defaultMaxListeners = 10;

function checkListener( listener )
{
    if ( typeof listener !== 'function' )
        throw new ERR_INVALID_ARG_TYPE( 'listener', 'Function', listener );
}

Object.defineProperty( EventEmitter, 'defaultMaxListeners', {
    enumerable: true,
    get:        () => defaultMaxListeners,
    set:        function( arg ) {
        if ( typeof arg !== 'number' || arg < 0 || Number.isNaN( arg ) ) { throw new ERR_OUT_OF_RANGE(
            'defaultMaxListeners', 'a non-negative number', arg ); }

        defaultMaxListeners = arg;
    }
});

EventEmitter.init = function( opts ) {

    if ( this._events === undefined || this._events === Object.getPrototypeOf( this )._events )
    {
        this._events      = Object.create( null );
        this._eventsCount = 0;
    }

    this._maxListeners = this._maxListeners || undefined;


    if ( opts && opts.captureRejections )
    {
        if ( typeof opts.captureRejections !== 'boolean' ) { throw new ERR_INVALID_ARG_TYPE(
            'options.captureRejections', 'boolean', opts.captureRejections ); }

        this[ kCapture ] = Boolean( opts.captureRejections );
    }
    else
    {
        // Assigning the kCapture property directly saves an expensive prototype lookup in a very sensitive hot path.
        this[ kCapture ] = EventEmitter.prototype[ kCapture ];
    }
};

function addCatch( that, promise, type, args )
{
    if ( !that[ kCapture ] ) return;

    // Handle Promises/A+ spec, then could be a getter that throws on second use.
    try
    {
        const then = promise.then;

        if ( typeof then === 'function' )
        {
            // The callback is called with nextTick to avoid a follow-up rejection from this promise.
            then.call( promise, undefined, err => process.nextTick( emitUnhandledRejectionOrErr, that, err, type, args ) );
        }
    }
    catch ( err )
    {
        that.emit( 'error', err );
    }
}

function emitUnhandledRejectionOrErr( ee, err, type, args )
{
    if ( typeof ee[ kRejection ] === 'function' )
        ee[ kRejection ]( err, type, ...args );
    else
    {
        // We have to disable the capture rejections mechanism, otherwise we might end up in an infinite loop.
        const prev = ee[ kCapture ];

        // If the error handler throws, it is not catcheable and it  will end up in 'uncaughtException'. We restore the previous
        // value of kCapture in case the uncaughtException is present and the exception is handled.
        try
        {
            ee[ kCapture ] = false;
            ee.emit( 'error', err );
        }
        finally
        {
            ee[ kCapture ] = prev;
        }
    }
}

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function setMaxListeners( n ) {
    if ( typeof n !== 'number' || n < 0 || Number.isNaN( n ) )
        throw new ERR_OUT_OF_RANGE( 'n', 'a non-negative number', n );

    this._maxListeners = n;
    return this;
};

function _getMaxListeners( that )
{
    return that._maxListeners === undefined ? EventEmitter.defaultMaxListeners :  that._maxListeners;
}

EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
    return _getMaxListeners( this );
};

EventEmitter.prototype.emit = function emit( type, ...args ) {
    let doError = ( type === 'error' );

    const events = this._events;
    if ( events !== undefined )
    {
        if ( doError && events[ kErrorMonitor ] !== undefined )
            this.emit( kErrorMonitor, ...args );
        doError = ( doError && events.error === undefined );
    }
    else if ( !doError )
        return false;

    // If there is no 'error' event listener then throw.
    if ( doError )
    {
        let er;

        if ( args.length > 0 ) er = args[ 0 ];

        if ( er instanceof Error )
        {
            // Note: The comments on the `throw` lines are intentional, they show
            // up in Node's output if this results in an unhandled exception.
            throw er; // Unhandled 'error' event
        }

        let stringifiedEr = er.toString();

        // At least give some kind of context to the user
        const err   = new ERR_UNHANDLED_ERROR( stringifiedEr );
        err.context = er;
        throw err; // Unhandled 'error' event
    }

    const handler = events[ type ];

    if ( handler === undefined ) return false;

    if ( typeof handler === 'function' )
    {
        const result = Reflect.apply( handler, this, args );

        // We check if result is undefined first because that is the most common case so we do not pay any perf penalty
        if ( result !== undefined && result !== null )
            addCatch( this, result, type, args );
    }
    else
    {
        const len       = handler.length;
        const listeners = arrayClone( handler );
        for ( let i = 0; i < len; ++i )
        {
            const result = Reflect.apply( listeners[ i ], this, args );

            // We check if result is undefined first because that is the most common case so we do not pay any perf
            // penalty. This code is duplicated because extracting it away would make it non-inlineable.
            if ( result !== undefined && result !== null )
                addCatch( this, result, type, args );
        }
    }

    return true;
};

function _addListener( target, type, listener, prepend )
{
    let m;
    let events;
    let existing;

    checkListener( listener );

    events = target._events;
    if ( events === undefined )
    {
        events              = target._events = Object.create( null );
        target._eventsCount = 0;
    }
    else
    {
        // To avoid recursion in the case that type === "newListener"! Before adding it to the listeners, first emit "newListener".
        if ( events.newListener !== undefined )
        {
            target.emit( 'newListener', type, listener.listener ? listener.listener : listener );

            // Re-assign `events` because a newListener handler could have caused the
            // this._events to be assigned to a new object
            events = target._events;
        }

        existing = events[ type ];
    }

    if ( existing === undefined ) // Optimize the case of one listener. Don't need the extra array object.
    {
        events[ type ] = listener;
        ++target._eventsCount;
    }
    else
    {
        if ( typeof existing === 'function' ) // Adding the second element, need to change to array.
            existing = events[ type ] = prepend ? [ listener, existing ] : [ existing, listener ];
        else if ( prepend ) // If we've already got an array, just append.
            existing.unshift( listener );
        else
            existing.push( listener );


        // Check for listener leak
        m = _getMaxListeners( target );
        if ( m > 0 && existing.length > m && !existing.warned )
        {
            existing.warned = true;
            // No error code for this since it is a Warning
            // eslint-disable-next-line no-restricted-syntax
            const w   = new Error( 'Possible EventEmitter memory leak detected. ' +
                    `${existing.length} ${String( type )} listeners ` +
                    `added to ${target.constructor.name}. Use ` +
                    'emitter.setMaxListeners() to increase limit' );
            w.name    = 'MaxListenersExceededWarning';
            w.emitter = target;
            w.type    = type;
            w.count   = existing.length;
            process.emitWarning( w );
        }
    }

    return target;
}

EventEmitter.prototype.addListener = function addListener( type, listener ) {
    return _addListener( this, type, listener, false );
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.prependListener = function prependListener( type, listener ) {
    return _addListener( this, type, listener, true );
};

function onceWrapper( ...args )
{
    if ( !this.fired )
    {
        this.target.removeListener( this.type, this.wrapFn );
        this.fired = true;
        this.listener.call( this.target, ...args );
    }
}

function _onceWrap( target, type, listener )
{
    const state      = {
        fired:  false,
        wrapFn: undefined,
        target,
        type,
        listener
    };
    const wrapped    = onceWrapper.bind( state );
    wrapped.listener = listener;
    state.wrapFn     = wrapped;
    return wrapped;
}

EventEmitter.prototype.once = function once( type, listener ) {
    checkListener( listener );

    this.on( type, _onceWrap( this, type, listener ) );
    return this;
};

EventEmitter.prototype.prependOnceListener = function prependOnceListener( type, listener ) {
    checkListener( listener );

    this.prependListener( type, _onceWrap( this, type, listener ) );
    return this;
};

// Emits a 'removeListener' event if and only if the listener was removed.
EventEmitter.prototype.removeListener = function removeListener( type, listener ) {
    checkListener( listener );

    const events = this._events;
    if ( events === undefined ) return this;

    const list = events[ type ];
    if ( list === undefined ) return this;

    if ( list === listener || list.listener === listener )
    {
        if ( --this._eventsCount === 0 )
            this._events = Object.create( null );
        else
        {
            delete events[ type ];
            if ( events.removeListener )
                this.emit( 'removeListener', type, list.listener || listener );
        }
    }
    else if ( typeof list !== 'function' )
    {
        let position = -1;

        for ( let i = list.length - 1; i >= 0; i-- )
        {
            if ( list[ i ] === listener || list[ i ].listener === listener )
            {
                position = i;
                break;
            }
        }

        if ( position < 0 ) return this;

        if ( position === 0 )
            list.shift();
        else
            spliceOne( list, position );

        if ( list.length === 1 ) events[ type ] = list[ 0 ];

        if ( events.removeListener !== undefined )
            this.emit( 'removeListener', type, listener );
    }

    return this;
};

EventEmitter.prototype.off = EventEmitter.prototype.removeListener;

EventEmitter.prototype.removeAllListeners = function removeAllListeners( type ) {
    const events = this._events;

    if ( events === undefined )
        return this;

    // Not listening for removeListener, no need to emit
    if ( events.removeListener === undefined )
    {
        if ( arguments.length === 0 )
        {
            this._events      = Object.create( null );
            this._eventsCount = 0;
        }
        else if ( events[ type ] !== undefined )
        {
            if ( --this._eventsCount === 0 )
                this._events = Object.create( null );
            else
                delete events[ type ];
        }

        return this;
    }

    // Emit removeListener for all listeners on all events
    if ( arguments.length === 0 )
    {
        for ( const key of Reflect.ownKeys( events ) )
        {
            if ( key === 'removeListener' ) continue;
            this.removeAllListeners( key );
        }

        this.removeAllListeners( 'removeListener' );
        this._events      = Object.create( null );
        this._eventsCount = 0;
        return this;
    }

    const listeners = events[ type ];

    if ( typeof listeners === 'function' )
        this.removeListener( type, listeners );
    else if ( listeners !== undefined )
    {
        // LIFO order
        for ( let i = listeners.length - 1; i >= 0; i-- )
            this.removeListener( type, listeners[ i ] );
    }

    return this;
};

function _listeners( target, type, unwrap )
{
    const events = target._events;

    if ( events === undefined )
        return [];

    const evlistener = events[ type ];

    if ( evlistener === undefined )
        return [];

    if ( typeof evlistener === 'function' )
        return unwrap ? [ evlistener.listener || evlistener ] : [ evlistener ];

    return unwrap ? unwrapListeners( evlistener ) : arrayClone( evlistener );
}

EventEmitter.prototype.listeners = function listeners( type ) {
    return _listeners( this, type, true );
};

EventEmitter.prototype.rawListeners = function rawListeners( type ) {
    return _listeners( this, type, false );
};

EventEmitter.listenerCount = function( emitter, type ) {
    if ( typeof emitter.listenerCount === 'function' ) return emitter.listenerCount( type );

    return listenerCount.call( emitter, type );
};

EventEmitter.prototype.listenerCount = listenerCount;

function listenerCount( type )
{
    const events = this._events;

    if ( events !== undefined )
    {
        const evlistener = events[ type ];

        if ( typeof evlistener === 'function' )
            return 1;
        else if ( evlistener !== undefined )
            return evlistener.length;
    }

    return 0;
}

EventEmitter.prototype.eventNames = function eventNames() {
    return this._eventsCount > 0 ? Reflect.ownKeys( this._events ) : [];
};

function arrayClone( arr )
{
    // At least since V8 8.3, this implementation is faster than the previous which always used a simple for-loop
    switch ( arr.length )
    {
        case 2:
            return [ arr[ 0 ], arr[ 1 ] ];
        case 3:
            return [ arr[ 0 ], arr[ 1 ], arr[ 2 ] ];
        case 4:
            return [ arr[ 0 ], arr[ 1 ], arr[ 2 ], arr[ 3 ] ];
        case 5:
            return [ arr[ 0 ], arr[ 1 ], arr[ 2 ], arr[ 3 ], arr[ 4 ] ];
        case 6:
            return [ arr[ 0 ], arr[ 1 ], arr[ 2 ], arr[ 3 ], arr[ 4 ], arr[ 5 ] ];
    }
    return arr.slice();
}

function unwrapListeners( arr )
{
    const ret = arrayClone( arr );

    for ( let i = 0; i < ret.length; ++i )
    {
        const orig = ret[ i ].listener;
        if ( typeof orig === 'function' )
            ret[ i ] = orig;
    }

    return ret;
}

function once( emitter, name )
{
    return new Promise( ( resolve, reject ) => {
        const errorListener = err => {
            emitter.removeListener( name, resolver );
            reject( err );
        };

        const resolver      = ( ...args ) => {
            if ( typeof emitter.removeListener === 'function' )
                emitter.removeListener( 'error', errorListener );

            resolve( args );
        };

        eventTargetAgnosticAddListener( emitter, name, resolver, { once: true });

        if ( name !== 'error' )
            addErrorHandlerIfEventEmitter( emitter, errorListener, { once: true });
    });
}

const AsyncIteratorPrototype = Object.getPrototypeOf( Object.getPrototypeOf( async function *() {}).prototype );

const createIterResult = ( value, done ) => ({ value, done });

const addErrorHandlerIfEventEmitter = ( emitter, handler, flags ) =>
    typeof emitter.on === 'function' && eventTargetAgnosticAddListener( emitter, 'error', handler, flags );

function eventTargetAgnosticRemoveListener( emitter, name, listener, flags )
{
    if ( typeof emitter.removeListener === 'function' )
        emitter.removeListener( name, listener );
    else if ( typeof emitter.removeEventListener === 'function' )
        emitter.removeEventListener( name, listener, flags );
    else
        throw new ERR_INVALID_ARG_TYPE( 'emitter', 'EventEmitter', emitter );
}

function eventTargetAgnosticAddListener( emitter, name, listener, flags )
{
    if ( typeof emitter.on === 'function' )
    {
        if ( flags && flags.once )
            emitter.once( name, listener );
        else
            emitter.on( name, listener );
    }
    else if ( typeof emitter.addEventListener === 'function' )
    {
        // EventTarget does not have `error` event semantics like Node
        // EventEmitters, we do not listen to `error` events here.
        emitter.addEventListener( name, ( arg ) => { listener( arg ); }, flags );
    }
    else
        throw new ERR_INVALID_ARG_TYPE( 'emitter', 'EventEmitter', emitter );

}

function on( emitter, event )
{
    const unconsumedEvents   = [];
    const unconsumedPromises = [];
    let error                = null;
    let finished             = false;

    const iterator = Object.setPrototypeOf({
        next()
        {
            // First, we consume all unread events
            const value = unconsumedEvents.shift();
            if ( value )
                return Promise.resolve( createIterResult( value, false ) );


            // Then we error, if an error happened. This happens one time if at all, because after 'error' we stop listening
            if ( error )
            {
                const p = Promise.reject( error );
                error   = null; // Only the first element errors
                return p;
            }

            // If the iterator is finished, resolve to done
            if ( finished )
                return Promise.resolve( createIterResult( undefined, true ) );


            // Wait until an event happens
            return new Promise( ( resolve, reject ) => unconsumedPromises.push({ resolve, reject }) );
        },

        return()
        {
            eventTargetAgnosticRemoveListener( emitter, event, eventHandler );
            eventTargetAgnosticRemoveListener( emitter, 'error', errorHandler );
            finished = true;

            for ( const promise of unconsumedPromises )
                promise.resolve( createIterResult( undefined, true ) );

            return Promise.resolve( createIterResult( undefined, true ) );
        },

        throw( err )
        {
            if ( !err || !( err instanceof Error ) )
                throw new ERR_INVALID_ARG_TYPE( 'EventEmitter.AsyncIterator', 'Error', err );

            error = err;
            eventTargetAgnosticRemoveListener( emitter, event, eventHandler );
            eventTargetAgnosticRemoveListener( emitter, 'error', errorHandler );
        },

        [ Symbol.asyncIterator ]() { return this; }
    }, AsyncIteratorPrototype );

    eventTargetAgnosticAddListener( emitter, event, eventHandler );

    if ( event !== 'error' )
        addErrorHandlerIfEventEmitter( emitter, errorHandler );

    return iterator;

    function eventHandler( ...args )
    {
        const promise = unconsumedPromises.shift();
        if ( promise ) promise.resolve( createIterResult( args, false ) ); else unconsumedEvents.push( args );
    }

    function errorHandler( err )
    {
        finished = true;

        const toError = unconsumedPromises.shift();

        if ( toError )
            toError.reject( err );
        else
            error = err; // The next time we call next()

        iterator.return();
    }
}

export { EventEmitter, once, on };
