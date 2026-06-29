import { Router, type Router as RouterType } from "express";
import { getPreferences, setPreferences } from "../preferences.js";

const router: RouterType = Router();

router.get("/preferences", async (_req, res) => {
  res.json(await getPreferences());
});

router.put("/preferences", async (req, res) => {
  const next = await setPreferences(req.body);
  res.json(next);
});

export default router;
