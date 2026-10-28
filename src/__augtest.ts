import type { RouteServerOptions } from "@tanstack/start-client-core";
import type { FilebaseRouteOptionsInterface } from "@tanstack/router-core";
type HasServer = FilebaseRouteOptionsInterface<any>["server"];
const t: RouteServerOptions | undefined = undefined as unknown as HasServer;
export {};
