import type { EndpointDef } from "../types.js";
import { mailEndpoints } from "./mail.js";
import { mailWriteEndpoints } from "./mailWrite.js";
import { calendarEndpoints } from "./calendar.js";
import { calendarWriteEndpoints } from "./calendarWrite.js";
import { availabilityEndpoints } from "./availability.js";
import { teamsWriteEndpoints } from "./teamsWrite.js";
import { teamsEndpoints } from "./teams.js";
import { meetingsEndpoints } from "./meetings.js";
import { onenoteEndpoints } from "./onenote.js";
import { sharepointEndpoints } from "./sharepoint.js";
import { onedriveEndpoints } from "./onedrive.js";
import { loopEndpoints } from "./loop.js";
import { searchEndpoints } from "./search.js";
import { usersEndpoints } from "./users.js";
import { salesforceEndpoints } from "./salesforce.js";
import { salesforceWriteEndpoints } from "./salesforceWrite.js";

/** The complete Reporting MCP v1 tool matrix (Salesforce is optional - see registry.isToolEnabled). */
export const allEndpoints: EndpointDef[] = [
  ...mailEndpoints,
  ...mailWriteEndpoints,
  ...calendarEndpoints,
  ...availabilityEndpoints,
  ...calendarWriteEndpoints,
  ...teamsEndpoints,
  ...teamsWriteEndpoints,
  ...meetingsEndpoints,
  ...onenoteEndpoints,
  ...sharepointEndpoints,
  ...onedriveEndpoints,
  ...loopEndpoints,
  ...searchEndpoints,
  ...usersEndpoints,
  ...salesforceEndpoints,
  ...salesforceWriteEndpoints,
];

const names = new Set<string>();
for (const def of allEndpoints) {
  if (names.has(def.name)) throw new Error(`Duplicate tool name in endpoint matrix: ${def.name}`);
  names.add(def.name);
}
