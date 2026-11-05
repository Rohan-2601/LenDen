import { MessageProvider } from "./messageProvider.js";
// Future adapter would implement send using Cloud API; select it through provider injection.
// No credentials, network calls or real messaging are used in this assignment.
export class CloudApiProvider extends MessageProvider {}
