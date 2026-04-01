import { NextRequest } from "next/server";
import { proxyLegacy } from "../../../lib/legacyProxy";

type Params = { params: { path: string[] } };

export async function GET(req: NextRequest, { params }: Params) {
  return proxyLegacy(req, `/static/${(params.path || []).join("/")}`);
}

