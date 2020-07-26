/** ******************************************************************************************************************
 * @file Unit test for work things, node.js section goes here.
 * @author Julian Jensen <jjdanois@gmail.com>
 * @since 1.0.0
 * @date 26-Jul-2020
 *********************************************************************************************************************/
/* eslint-env mocha, chai */
"use strict";

import * as chai from 'chai';
import wrap from '../src/index.js';

const { expect } = chai.default;

describe( 'Given main thread worker wrapper', () => {

    let target, name;

    before( async () => {
        target = await wrap( './test/nw-class.js' );
        name = await target.name;
    } );
    after( async () => new Promise( r => setTimeout( async () => { await target.terminate(); r(); }, 200 ) ) );

    describe( 'When asked to wrap a worker', () => {
        it( 'Then should return a function', () => {
            expect( target ).to.be.a( 'function' );
            expect( name ).to.equal( 'WorkerTest' );
        });

        describe( 'When asked to call top level function', () => {
            let counter;

            beforeEach( async () => counter = await target.counter( 10, 20, 30 ) );

            it( 'Then should call function correctly', () => {
                expect( counter ).to.equal( 3 );
            });
        });
    } );

    describe( 'When asked to construct', async () => {
        let instance;

        beforeEach( async () => instance = await new target( 10, 20, 30 ) );
        it( 'Then should construct object', () => {
            expect( instance ).to.be.an( 'object' );
        } );
    } );

});
