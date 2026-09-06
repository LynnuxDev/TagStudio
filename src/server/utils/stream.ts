import { createReadStream, type ReadStream } from 'fs'

/**
 * A file stream that dies with the client connection. Refresh, tab close,
 * player unmount, or a seek that aborts the in-flight request all abort the
 * request signal — without this the server would keep reading the file for
 * nobody until the range is exhausted.
 */
export function abortableFileStream(
  signal: AbortSignal,
  targetPath: string,
  opts?: { start?: number; end?: number },
): ReadStream {
  const stream = createReadStream(targetPath, opts)
  if (signal.aborted) {
    stream.destroy()
  } else {
    signal.addEventListener('abort', () => stream.destroy(), { once: true })
  }
  return stream
}
