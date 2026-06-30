import "i18next";
import type { resources } from "./index";

// Type the t() function against the English resources so keys are checked.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: (typeof resources)["en"];
  }
}
