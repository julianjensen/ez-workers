/** ******************************************************************************************************************
 * @file Attempt to remove reference across threads.
 * @author Julian Jensen <jjdanois@gmail.com>
 * @since 1.0.0
 * @date 26-Jul-2020
 *********************************************************************************************************************/
"use strict";

export default function destroyer( release )
{
    const
        registry = new FinalizationRegistry( index => release( index ) );

    return ( thing, index ) => registry.register( thing, index );

}
