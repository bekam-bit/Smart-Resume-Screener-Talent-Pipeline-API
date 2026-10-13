import type { OrganizationRole } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      userId?: string;
      organizationId?: string;
      organizationRole?: OrganizationRole;
      jobId?: string;
      applicationId?: string;
    }
  }
}

export {};