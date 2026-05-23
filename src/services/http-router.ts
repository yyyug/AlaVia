export type RouteHandler = () => Promise<Response>;

export type RouteDefinition = {
  pathname: string;
  method: string;
  handler: RouteHandler;
};

export async function dispatchRoute(
  pathname: string,
  method: string,
  routes: RouteDefinition[]
): Promise<Response | null> {
  const matched = routes.find((route) => route.pathname === pathname && route.method === method);
  if (!matched) {
    return null;
  }

  return matched.handler();
}
