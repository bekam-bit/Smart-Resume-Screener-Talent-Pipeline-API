import type { OrganizationRole } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      organizationId?: string;
      organizationRole?: OrganizationRole;
      jobId?: string;
    }
  }
}

export {};