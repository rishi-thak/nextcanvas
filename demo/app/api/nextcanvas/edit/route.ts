import { acknowledge } from '../acknowledge';

/**
 * Stands in for the package's dev write-back server on the deployed demo.
 *
 * It deliberately writes nothing. The overlay is already DOM-authoritative —
 * text arrives via contentEditable, attributes via setAttribute — and it only
 * *reverts* the DOM when the server rejects an edit. So acknowledging every
 * edit leaves the visitor's change standing in their own page, and a reload
 * serves the original HTML again. That is the whole trick: no source is
 * touched, and nothing persists.
 */
export const POST = acknowledge;
