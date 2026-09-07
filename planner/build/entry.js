// Indgang til tp-bundle.js: gør mdb-reader tilgængelig i browseren som
// window.MDBReader sammen med det Buffer-polyfill, biblioteket kræver.
// mdb-reader vil have et rigtigt Buffer — et råt Uint8Array fejler med
// "copy is not a function" — derfor Buffer.from(new Uint8Array(arrayBuffer)).
import MDBReader from 'mdb-reader';
import { Buffer } from 'buffer';

window.MDBReader = MDBReader;
window.TPBuffer = Buffer;
