import { localeString, localeText, localeArray } from "../lib/localeString.js";
import { room } from "./room.js";
import { menuCategory } from "./menuCategory.js";
import { eventPackage } from "./eventPackage.js";
import { specialOffer } from "./specialOffer.js";
import { attraction } from "./attraction.js";
import { pageContent } from "./pageContent.js";
import { siteSettings } from "./siteSettings.js";

export const schemaTypes = [
  // reusable types
  localeString,
  localeText,
  localeArray,
  // documents
  siteSettings,
  pageContent,
  room,
  menuCategory,
  eventPackage,
  specialOffer,
  attraction,
];
