import { registerAdapter } from "../registry.js";
import {
  transformParty,
  transformItem,
  transformInvoice,
  transformPayment,
  transformTransfer,
} from "./transforms.js";

registerAdapter("hisaabo", {
  transformParty,
  transformItem,
  transformInvoice,
  transformPayment,
  transformTransfer,
});
