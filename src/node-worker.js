async function workerChannels()
{
    const { parentPort } = await import( 'worker_threads' );
    globalThis.postMessage = ( value, transferList ) => parentPort.postMessage( value, transferList );
    globalThis.onmessage = fn => parentPort.on( 'message', fn );
}
