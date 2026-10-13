import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { authenticate } from "../../middlewares/authenticate.js";
import { requireTrustedOrigin } from "../../middlewares/trusted-origin.js";
import { forgotPasswordController, loginController, logoutAllController, logoutController, refreshController, registerController, resendVerificationController, resetPasswordController, verifyEmailController } from "./auth.controller.js";

export const authRouter = Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });

authRouter.post("/register", authLimiter, registerController);
authRouter.post("/login", authLimiter, loginController);
authRouter.post("/refresh", requireTrustedOrigin, authLimiter, refreshController);
authRouter.post("/logout", requireTrustedOrigin, logoutController);
authRouter.post("/logout-all", authenticate, requireTrustedOrigin, logoutAllController);
authRouter.post("/verify-email", authLimiter, verifyEmailController);
authRouter.post("/verify-email/resend", authLimiter, resendVerificationController);
authRouter.post("/password/forgot", authLimiter, forgotPasswordController);
authRouter.post("/password/reset", authLimiter, resetPasswordController);