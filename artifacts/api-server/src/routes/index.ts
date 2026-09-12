import {
  Router,
  type IRouter,
} from "express";

import healthRouter from "./health";
import inventoryRouter from "./inventory";

import dashboardRouter from "./dashboard";
import clientsRouter from "./clients";
import providersRouter from "./providers";
import claimsRouter from "./claims";
import workqueuesRouter from "./workqueues";
import readinessRouter from "./readiness";
import clinicalRouter from "./clinical";
import chargesRouter from "./charges";

const router: IRouter = Router();

router.use(healthRouter);
router.use(inventoryRouter);

router.use(dashboardRouter);
router.use(clientsRouter);
router.use(providersRouter);
router.use(claimsRouter);
router.use(workqueuesRouter);
router.use(readinessRouter);
router.use(clinicalRouter);
router.use(chargesRouter);

export default router;
