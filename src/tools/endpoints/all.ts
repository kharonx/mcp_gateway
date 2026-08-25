import type { EndpointDef } from "../types.js";
import { mailEndpoints } from "./mail.js";
import { mailWriteEndpoints } from "./mailWrite.js";
import { calendarEndpoints } from "./calendar.js";
import { teamsEndpoints } from "./teams.js";
import { meetingsEndpoints } from "./meetings.js";
import { onenoteEndpoints } from "./onenote.js";
import { sharepointEndpoints } from "./sharepoint.js";
import { onedriveEndpoints } from "./onedrive.js";
import { loopEndpoints } from "./loop.js";
import { searchEndpoints } from "./search.js";
import { usersEndpoints } from "./users.js";

/** The complete Reporting MCP v1 tool matrix. */
export const allEndpoints: EndpointDef[] = [
  ...mailEndpoints,
  ...mailWriteEndpoints,
  ...calendarEndpoints,
  ...teamsEndpoints,
  ...meetingsEndpoints,
  ...onenoteEndpoints,
  ...sharepointEndpoints,
  ...onedriveEndpoints,
  ...loopEndpoints,
  ...searchEndpoints,
  ...usersEndpoints,
];

const names = new Set<string>();
for (const def of allEndpoints) {
  if (names.has(def.name)) throw new Error(`Duplicate tool name in endpoint matrix: ${def.name}`);
  names.add(def.name);
}
