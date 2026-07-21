/**
 * Shared handler for the demo's stand-in write-back endpoints (/edit, /style).
 *
 * Echoes back the shape the overlay expects on success and writes nothing. The
 * request body is read and discarded so the client always sees a clean
 * completion rather than an aborted stream.
 */
export async function acknowledge(req: Request): Promise<Response> {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // A malformed body still gets an ack — there is nothing here to corrupt.
  }

  return Response.json({
    ok: true,
    demo: true,
    fileName: typeof body.fileName === 'string' ? body.fileName : undefined,
    lineNumber: body.lineNumber,
    oldText: body.oldText,
    newText: body.newText,
    property: body.property,
    value: body.value,
  });
}
