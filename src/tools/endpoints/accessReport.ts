import { z } from "zod";
import type { EndpointDef, ToolContext } from "../types.js";
import { GraphError, type GraphClient } from "../../graph/client.js";

/**
 * User access report ("kilépési riport"): what a given user can reach in
 * Microsoft 365 and what was shared with / by them - assembled from Graph with
 * the CALLER's delegated permissions (Directory.Read.All, Sites.Read.All,
 * Files.Read.All, Team.ReadBasic.All). Read-only, no side effects.
 *
 * What Graph can and cannot tell us (documented in the result `notes`):
 * - Group / Teams / directory-role membership: full (transitive), incl. group-
 *   connected SharePoint sites and Teams with owner/member role.
 * - Item-level permissions: only items that carry the `shared` facet are
 *   inspected (an item that was never shared beyond its default inheritance
 *   cannot grant anything extra), and only within the scanned sites/drives.
 * - Classic SharePoint site role assignments (Owners/Members/Visitors site
 *   groups) are NOT exposed by Graph with delegated permissions; a site group
 *   grant is reported as unresolved instead of silently dropped.
 * - Other people's OneDrives cannot be enumerated; "shared with the user" comes
 *   from the user's sharedWithMe view and Insights where Graph allows it.
 */

const SCOPES = ["Directory.Read.All", "Sites.Read.All", "Files.Read.All", "Team.ReadBasic.All"];

interface Grant {
  site: string;
  siteUrl?: string;
  drive: string;
  itemName: string;
  itemPath: string;
  itemUrl?: string;
  itemType: "folder" | "file" | "library";
  how: string;
  roles: string[];
  inherited: boolean;
  inheritedFrom?: string;
  permissionId?: string;
  expires?: string;
}

interface Stats {
  graphCalls: number;
  sitesScanned: number;
  drivesScanned: number;
  itemsScanned: number;
  permissionsChecked: number;
  truncated: string[];
}

function isGraphStatus(err: unknown, ...codes: number[]): boolean {
  return err instanceof GraphError && codes.includes(err.status);
}

function errMsg(err: unknown): string {
  return err instanceof GraphError ? `${err.status} ${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err);
}

async function tryGet<T>(graph: GraphClient, stats: Stats, path: string, query?: Record<string, string | undefined>): Promise<T | undefined> {
  stats.graphCalls++;
  try {
    return (await graph.request("GET", path, { query })) as T;
  } catch (err) {
    if (isGraphStatus(err, 403, 404, 400)) return undefined;
    throw err;
  }
}

async function pagedAll(
  graph: GraphClient,
  stats: Stats,
  path: string,
  query: Record<string, string | undefined>,
  max: number,
  label: string
): Promise<any[]> {
  stats.graphCalls++;
  const r = await graph.getPaged(path, query, max);
  if (r.truncated) stats.truncated.push(`${label}: stopped after ${r.count} items`);
  return r.items as any[];
}

/** Describe who a permission grants access to, matched against the user and their groups. */
function matchPermission(
  p: any,
  userId: string,
  userMails: Set<string>,
  groupNames: Map<string, string>
): { how: string; kind: "direct" | "group" | "link" } | null {
  const isUser = (ident: any) =>
    ident && ((ident.id && ident.id === userId) || (ident.email && userMails.has(String(ident.email).toLowerCase())));
  const g2 = p.grantedToV2 ?? {};
  const g1 = p.grantedTo ?? {};
  if (isUser(g2.user) || isUser(g1.user)) return { how: "direct", kind: "direct" };
  if (g2.group?.id && groupNames.has(g2.group.id)) return { how: `group: ${groupNames.get(g2.group.id)}`, kind: "group" };
  const list: any[] = [...(p.grantedToIdentitiesV2 ?? []), ...(p.grantedToIdentities ?? [])];
  for (const ident of list) {
    if (isUser(ident.user)) return { how: p.link ? `link (${p.link.scope ?? "users"}, sent to the user)` : "direct (invitation)", kind: "direct" };
    if (ident.group?.id && groupNames.has(ident.group.id)) return { how: `group: ${groupNames.get(ident.group.id)}`, kind: "group" };
  }
  if (p.link?.scope === "organization") return { how: "link: anyone in the organization", kind: "link" };
  if (p.link?.scope === "anonymous") return { how: "link: anyone with the link (anonymous)", kind: "link" };
  return null;
}

function siteGroupName(p: any): string | null {
  const sg = p.grantedToV2?.siteGroup ?? p.grantedToV2?.siteUser;
  if (sg) return String(sg.displayName ?? sg.loginName ?? sg.id ?? "SharePoint group");
  for (const ident of p.grantedToIdentitiesV2 ?? []) {
    if (ident.siteGroup) return String(ident.siteGroup.displayName ?? ident.siteGroup.id);
  }
  return null;
}

export const accessReportEndpoints: EndpointDef[] = [
  {
    name: "get-user-access-report",
    description:
      "ACCESS / OFFBOARDING REPORT for one Microsoft 365 user: what they can reach and what was shared with them. Walks: directory roles and group memberships (transitive, with owner/member role), Teams, group-connected SharePoint sites, then the SharePoint sites the caller can see (site -> document libraries -> folders/files that carry a sharing record) and matches every permission and sharing link to the user directly, via their groups, or via organization-wide/anonymous links, noting inherited vs direct grants. Also lists what the user's own OneDrive shares with others, items shared WITH the user (sharedWithMe, Insights) where Graph allows it. Runs with the caller's own permissions: only sites/libraries the caller can read are scanned. Expensive: scope it with siteSearch and the limits; the result carries stats, truncation flags and notes about what Graph cannot see (classic SharePoint site-group assignments are reported as unresolved). Read-only.",
    toolset: "users",
    provider: "graph",
    scopes: SCOPES,
    method: "GET",
    path: "/users/{user}/access-report",
    pathParamDescriptions: { user: "User principal name (e-mail) or object id of the user to report on" },
    resourceType: "accessReport",
    extraInput: {
      siteSearch: z.string().optional().describe("Only scan SharePoint sites whose name/URL matches this search term (Graph site search). Default: all sites the caller can see, up to maxSites."),
      maxSites: z.number().int().min(1).max(50).optional().describe("Max SharePoint sites to scan (default 10)"),
      maxItemsPerDrive: z.number().int().min(50).max(2000).optional().describe("Max folders/files listed per document library (default 300)"),
      maxDepth: z.number().int().min(1).max(8).optional().describe("Folder depth to walk inside each library (default 4)"),
      includeOneDrive: z.boolean().optional().describe("Also inspect the user's own OneDrive for items they shared with others (default true)"),
      includeSharedWithUser: z.boolean().optional().describe("Try the user's sharedWithMe view and shared Insights (default true; Graph may refuse these for another user)"),
    },
    handler: async (args, ctx: ToolContext) => {
      const graph = ctx.graph;
      const stats: Stats = { graphCalls: 0, sitesScanned: 0, drivesScanned: 0, itemsScanned: 0, permissionsChecked: 0, truncated: [] };
      const notes: string[] = [];
      const errors: string[] = [];
      const maxSites = Math.min(Number(args.maxSites) || 10, 50);
      const maxItems = Math.min(Number(args.maxItemsPerDrive) || 300, 2000);
      const maxDepth = Math.min(Number(args.maxDepth) || 4, 8);

      // 1. The user ------------------------------------------------------
      const userKey = encodeURIComponent(String(args.user));
      stats.graphCalls++;
      const user = (await graph.request("GET", `/users/${userKey}`, {
        query: { $select: "id,displayName,userPrincipalName,mail,accountEnabled,jobTitle,department,otherMails,proxyAddresses" },
      })) as any;
      const userId = String(user.id);
      const userMails = new Set<string>(
        [user.mail, user.userPrincipalName, ...(user.otherMails ?? []), ...(user.proxyAddresses ?? []).map((p: string) => p.replace(/^smtp:/i, ""))]
          .filter(Boolean)
          .map((m: string) => m.toLowerCase())
      );

      // 2. Memberships (transitive) + direct + owned ----------------------
      const memberSelect = "id,displayName,groupTypes,mail,visibility,resourceProvisioningOptions,securityEnabled,mailEnabled,description";
      const transitive = await pagedAll(graph, stats, `/users/${userId}/transitiveMemberOf`, { $select: memberSelect, $top: "999" }, 2000, "transitiveMemberOf");
      const direct = await pagedAll(graph, stats, `/users/${userId}/memberOf`, { $select: "id" }, 2000, "memberOf");
      const owned = await pagedAll(graph, stats, `/users/${userId}/ownedObjects`, { $select: "id" }, 2000, "ownedObjects");
      const directIds = new Set(direct.map((g) => String(g.id)));
      const ownedIds = new Set(owned.map((g) => String(g.id)));
      const groupNames = new Map<string, string>();
      const groups: any[] = [];
      const roles: any[] = [];
      for (const g of transitive) {
        const type = String(g["@odata.type"] ?? "");
        if (type.endsWith("directoryRole")) {
          roles.push({ id: g.id, name: g.displayName, description: g.description });
          continue;
        }
        groupNames.set(String(g.id), String(g.displayName ?? g.id));
        const unified = (g.groupTypes ?? []).includes("Unified");
        const team = (g.resourceProvisioningOptions ?? []).includes("Team");
        groups.push({
          id: g.id,
          name: g.displayName,
          kind: team ? "team" : unified ? "m365Group" : g.securityEnabled ? (g.mailEnabled ? "mailEnabledSecurity" : "security") : "distributionList",
          mail: g.mail ?? undefined,
          visibility: g.visibility ?? undefined,
          role: ownedIds.has(String(g.id)) ? "owner" : "member",
          membership: directIds.has(String(g.id)) ? "direct" : "nested",
        });
      }

      // 3. Group-connected sites (M365 groups & Teams) -------------------
      const groupSites: any[] = [];
      const siteById = new Map<string, any>();
      for (const g of groups.filter((x) => x.kind === "team" || x.kind === "m365Group").slice(0, 60)) {
        const site = await tryGet<any>(graph, stats, `/groups/${g.id}/sites/root`, { $select: "id,webUrl,displayName,name" });
        if (!site) continue;
        siteById.set(String(site.id), site);
        groupSites.push({
          site: site.displayName ?? site.name,
          siteUrl: site.webUrl,
          siteId: site.id,
          viaGroup: g.name,
          groupKind: g.kind,
          role: g.role,
          access: g.role === "owner" ? "Full control (group owner)" : "Edit (group member)",
          membership: g.membership,
        });
      }
      if (groups.filter((x) => x.kind === "team" || x.kind === "m365Group").length > 60) {
        stats.truncated.push("group-connected sites: only the first 60 groups resolved");
      }

      // 4. Sites to scan --------------------------------------------------
      const search = typeof args.siteSearch === "string" && args.siteSearch.trim() ? args.siteSearch.trim() : "*";
      const found = await pagedAll(graph, stats, "/sites", { search, $select: "id,webUrl,displayName,name" }, maxSites, "sites");
      for (const s of found) siteById.set(String(s.id), s);
      let sites = [...siteById.values()];
      if (search !== "*") {
        const needle = search.toLowerCase();
        sites = sites.filter((s) => `${s.displayName ?? ""} ${s.name ?? ""} ${s.webUrl ?? ""}`.toLowerCase().includes(needle) || found.some((f) => f.id === s.id));
      }
      if (sites.length > maxSites) {
        stats.truncated.push(`sites: ${sites.length} candidates, scanning the first ${maxSites} (raise maxSites or use siteSearch)`);
        sites = sites.slice(0, maxSites);
      }

      // 5. Walk libraries and check shared items -------------------------
      const grants: Grant[] = [];
      const unresolvedSiteGroups: any[] = [];
      const linkGrants: Grant[] = [];

      const checkPermissions = async (siteName: string, siteUrl: string | undefined, drive: any, item: any, itemType: Grant["itemType"], path: string) => {
        const perms = await tryGet<any>(graph, stats, `/drives/${drive.id}/items/${item.id}/permissions`);
        if (!perms?.value) return;
        for (const p of perms.value) {
          stats.permissionsChecked++;
          const m = matchPermission(p, userId, userMails, groupNames);
          const inheritedFrom = p.inheritedFrom?.path ?? p.inheritedFrom?.id;
          const base: Grant = {
            site: siteName,
            siteUrl,
            drive: drive.name ?? drive.id,
            itemName: item.name,
            itemPath: path,
            itemUrl: item.webUrl,
            itemType,
            how: m?.how ?? "",
            roles: p.roles ?? [],
            inherited: !!p.inheritedFrom,
            inheritedFrom: inheritedFrom ? String(inheritedFrom) : undefined,
            permissionId: p.id,
            expires: p.expirationDateTime ?? undefined,
          };
          if (m?.kind === "link") linkGrants.push(base);
          else if (m) grants.push(base);
          else {
            const sg = siteGroupName(p);
            if (sg && !p.inheritedFrom) {
              unresolvedSiteGroups.push({ site: siteName, drive: drive.name, itemName: item.name, itemPath: path, itemUrl: item.webUrl, siteGroup: sg, roles: p.roles ?? [] });
            }
          }
        }
      };

      for (const site of sites) {
        const siteName = String(site.displayName ?? site.name ?? site.id);
        try {
          const drives = await pagedAll(graph, stats, `/sites/${site.id}/drives`, { $select: "id,name,webUrl,driveType" }, 50, `drives of ${siteName}`);
          stats.sitesScanned++;
          for (const drive of drives) {
            stats.drivesScanned++;
            // Library-level permissions (root): direct grants on the whole library.
            const root = await tryGet<any>(graph, stats, `/drives/${drive.id}/root`, { $select: "id,name,webUrl" });
            if (root) await checkPermissions(siteName, site.webUrl, drive, { ...root, name: drive.name ?? root.name }, "library", "/");
            // BFS over folders; only items with a sharing record get a permissions call.
            let listed = 0;
            const queue: { id: string; path: string; depth: number }[] = [{ id: "root", path: "", depth: 0 }];
            while (queue.length && listed < maxItems) {
              const cur = queue.shift()!;
              const children = await pagedAll(
                graph,
                stats,
                cur.id === "root" ? `/drives/${drive.id}/root/children` : `/drives/${drive.id}/items/${cur.id}/children`,
                { $select: "id,name,webUrl,folder,file,shared,size,lastModifiedDateTime", $top: "200" },
                Math.max(1, maxItems - listed),
                `${siteName}/${drive.name}${cur.path || "/"}`
              );
              for (const c of children) {
                listed++;
                stats.itemsScanned++;
                const path = `${cur.path}/${c.name}`;
                if (c.shared) await checkPermissions(siteName, site.webUrl, drive, c, c.folder ? "folder" : "file", path);
                if (c.folder && cur.depth + 1 < maxDepth && c.folder.childCount > 0) queue.push({ id: c.id, path, depth: cur.depth + 1 });
              }
            }
            if (listed >= maxItems || queue.length) stats.truncated.push(`${siteName}/${drive.name}: listing stopped at ${listed} items (maxItemsPerDrive/maxDepth)`);
          }
        } catch (err) {
          errors.push(`${siteName}: ${errMsg(err)}`);
        }
      }

      // 6. The user's own OneDrive: what THEY shared ---------------------
      const sharedByUser: any[] = [];
      if (args.includeOneDrive !== false) {
        const drive = await tryGet<any>(graph, stats, `/users/${userId}/drive`, { $select: "id,name,webUrl" });
        if (!drive) notes.push("OneDrive of the user is not accessible to the caller (not provisioned, or no permission) - 'shared by user' is empty.");
        else {
          let listed = 0;
          const queue: { id: string; path: string; depth: number }[] = [{ id: "root", path: "", depth: 0 }];
          while (queue.length && listed < maxItems) {
            const cur = queue.shift()!;
            const children = await pagedAll(
              graph,
              stats,
              cur.id === "root" ? `/drives/${drive.id}/root/children` : `/drives/${drive.id}/items/${cur.id}/children`,
              { $select: "id,name,webUrl,folder,file,shared,lastModifiedDateTime", $top: "200" },
              Math.max(1, maxItems - listed),
              `OneDrive${cur.path || "/"}`
            );
            for (const c of children) {
              listed++;
              stats.itemsScanned++;
              const path = `${cur.path}/${c.name}`;
              if (c.shared) {
                const perms = await tryGet<any>(graph, stats, `/drives/${drive.id}/items/${c.id}/permissions`);
                for (const p of perms?.value ?? []) {
                  stats.permissionsChecked++;
                  if (p.inheritedFrom) continue;
                  const who: string[] = [];
                  const g2 = p.grantedToV2 ?? {};
                  if (g2.user) who.push(g2.user.email ?? g2.user.displayName ?? g2.user.id);
                  if (g2.group) who.push(`group: ${g2.group.displayName ?? g2.group.id}`);
                  for (const i of p.grantedToIdentitiesV2 ?? []) who.push(i.user?.email ?? i.user?.displayName ?? (i.group ? `group: ${i.group.displayName}` : "?"));
                  if (p.link) who.push(`link: ${p.link.scope ?? "users"}${p.link.type ? " (" + p.link.type + ")" : ""}`);
                  if (who.length && !(who.length === 1 && userMails.has(String(who[0]).toLowerCase()))) {
                    sharedByUser.push({ itemName: c.name, itemPath: path, itemUrl: c.webUrl, itemType: c.folder ? "folder" : "file", sharedWith: who, roles: p.roles ?? [], expires: p.expirationDateTime ?? undefined });
                  }
                }
              }
              if (c.folder && cur.depth + 1 < maxDepth && c.folder.childCount > 0) queue.push({ id: c.id, path, depth: cur.depth + 1 });
            }
          }
          if (listed >= maxItems || queue.length) stats.truncated.push(`OneDrive: listing stopped at ${listed} items`);
        }
      }

      // 7. Shared WITH the user (best effort) ----------------------------
      const sharedWithUser: any[] = [];
      if (args.includeSharedWithUser !== false) {
        const swm = await tryGet<any>(graph, stats, `/users/${userId}/drive/sharedWithMe`);
        if (!swm) notes.push("sharedWithMe is not available for another user with delegated permissions - 'shared with user' relies on Insights and the site scan.");
        else {
          for (const it of swm.value ?? []) {
            const r = it.remoteItem ?? it;
            sharedWithUser.push({ source: "sharedWithMe", itemName: r.name ?? it.name, itemUrl: r.webUrl ?? it.webUrl, sharedBy: r.shared?.sharedBy?.user?.displayName ?? r.shared?.owner?.user?.displayName, sharedAt: r.shared?.sharedDateTime, location: r.parentReference?.siteId ?? r.parentReference?.driveId });
          }
        }
        const ins = await tryGet<any>(graph, stats, `/users/${userId}/insights/shared`, { $top: "50" });
        if (!ins) notes.push("Insights (shared) is not available for this user to the caller.");
        else {
          for (const i of ins.value ?? []) {
            sharedWithUser.push({ source: "insights", itemName: i.resourceVisualization?.title, itemUrl: i.resourceReference?.webUrl, type: i.resourceVisualization?.type, sharedBy: i.lastShared?.sharedBy?.displayName ?? i.lastShared?.sharedBy?.address, sharedAt: i.lastShared?.sharedDateTime, sharingType: i.lastShared?.sharingType });
          }
        }
      }

      notes.push(
        "Scope: everything above is what the CALLER can see. Sites/libraries the caller cannot read were not scanned.",
        "Only items with a sharing record (the 'shared' facet) were checked for permissions; un-shared items cannot grant extra access beyond their library.",
        "Classic SharePoint site role assignments (Owners/Members/Visitors site groups, direct site-level grants) are not exposed by Graph with delegated permissions - grants to a site group are listed under unresolvedSiteGroups; check them in the SharePoint site permissions page.",
        "Private/shared Teams channel sites are not enumerated separately; standard channels are covered by the team's group site.",
        "Files in other people's OneDrives shared with the user appear only under sharedWithUser (if Graph allowed it), not in the site scan."
      );

      const summary = {
        user: { id: user.id, displayName: user.displayName, userPrincipalName: user.userPrincipalName, mail: user.mail, accountEnabled: user.accountEnabled, jobTitle: user.jobTitle, department: user.department },
        counts: {
          directoryRoles: roles.length,
          groups: groups.length,
          teams: groups.filter((g) => g.kind === "team").length,
          groupConnectedSites: groupSites.length,
          sitesScanned: stats.sitesScanned,
          directOrGroupGrants: grants.length,
          organizationOrAnonymousLinks: linkGrants.length,
          unresolvedSiteGroupGrants: unresolvedSiteGroups.length,
          sharedByUser: sharedByUser.length,
          sharedWithUser: sharedWithUser.length,
        },
      };

      return {
        ...summary,
        directoryRoles: roles,
        groups,
        groupConnectedSites: groupSites,
        scannedSites: sites.map((s) => ({ site: s.displayName ?? s.name, siteUrl: s.webUrl, siteId: s.id })),
        grants,
        organizationOrAnonymousLinks: linkGrants,
        unresolvedSiteGroups,
        sharedByUser,
        sharedWithUser,
        stats,
        errors,
        notes,
        _source: { sourceType: "accessReport", sourceId: user.id, sourceUrl: `https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/~/overview/userId/${user.id}` },
      };
    },
  },
];
