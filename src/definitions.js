/**
 * @function makeHandler
 * @param {object} target
 * @param {string} target.__$type
 * @param {number} target.__$threadIndex
 * @param {string} target.__$name
 * @param {object[]} target.__$members
 * @return {*}
 */

// const _        = typeof globalThis !== 'undefined' ? globalThis : ( 1, eval )( 'this' ), // eslint-disable-line no-eval
//     handlers = new Map();
//
// const on   = ( name, handler ) => {
//         const list = handlers.get( name );
//
//         if ( !list )
//         {
//             handlers.set( name, new Set( [ handler ] ) );
//             return;
//         }
//
//         list.add( handler );
//     },
//
//     off  = ( name, handler ) => {
//         const list = handlers.get( name );
//
//         if ( !list || !list.has( handler ) ) return;
//
//         list.delete( handler );
//     },
//
//     once = ( name, handler ) => {
//         const _handler = ( name, data ) => {
//             off( name, _handler );
//             handler( name, data );
//         };
//
//         on( name, _handler );
//     },
//
//     emit = ( name, data ) => {
//         const list = handlers.get( name );
//
//         if ( !list || list.size === 0 ) return;
//
//         [ ...list ].forEach( fn => fn( name, data ) );
//     };

// _.onmessage = data => emit( 'message', data );
