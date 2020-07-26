export class WorkerTest {
    constructor( a, b, c ) {
        this.a = a;
        this.b = b;
        this.c = c;
    }

    initial()
    {
        return [ this.a, this.b, this.c ];
    }

    countArgs( ...args )
    {
        return args.length;
    }

    get first()
    {
        return this.a;
    }

    static counter( ...args )
    {
        return args.length;
    }
}

( async () => {
    const expose = ( await import( '../src/worker-handler.js' ) ).default;

    expose( WorkerTest );
} )();
