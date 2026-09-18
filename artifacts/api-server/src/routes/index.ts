import { Router, type IRouter } from "express";
import healthRouter from "./health";
import federationRouter from "./federation";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(requireAuth, federationRouter);

export default router;
