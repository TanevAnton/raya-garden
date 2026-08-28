import { localeString, localeText, localeArray } from "../lib/localeString.js";
import { room } from "./room.js";
import { specialOffer } from "./specialOffer.js";
import { attraction } from "./attraction.js";
import { pageContent } from "./pageContent.js";
import { siteSettings } from "./siteSettings.js";
import { eventPage } from "./eventPage.js";

export const schemaTypes = [
  // reusable types
  localeString,
  localeText,
  localeArray,
  // documents
  siteSettings,
  pageContent,
  room,
  specialOffer,
  eventPage,
  attraction,
];
