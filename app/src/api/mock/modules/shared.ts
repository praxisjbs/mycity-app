import { accepted, invalid, route } from "../core";

route("POST /api/v1/exports", (req) => (req.body.source ? accepted() : invalid({ source: ["Say what to export"] })));
