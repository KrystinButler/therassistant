import { Router, type IRouter } from "express";

import credentialingRouter from "../../routes/credentialing";
import credentialingMedicareRouter from "../../routes/credentialing-medicare";
import catalogRoutes from "./catalog-routes";

/**
 * Credentialing module facade.
 *
 * The application root mounts only this router. Credentialing owns its internal
 * routes and may create credentialing work, directory snapshots, and enrollment
 * updates. It must never mutate or gate claim workflow.
 */
const router: IRouter = Router();

router.use(credentialingRouter);
router.use(credentialingMedicareRouter);
router.use(catalogRoutes);

export default router;
