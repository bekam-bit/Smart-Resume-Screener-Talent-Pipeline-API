import { Router } from "express";
import { prisma } from "../../config/prisma.js";
import { authenticate } from "../../middlewares/authenticate.js";
import { requireOrganizationPermission } from "../../middlewares/authorize-organization.js";

export const jobsRouter = Router();

jobsRouter.get(
	"/organizations/:organizationId/jobs",
	authenticate,
	requireOrganizationPermission("job:read"),
	async (request, response) => {
		const jobs = await prisma.job.findMany({
			where: { organizationId: request.organizationId },
			orderBy: { createdAt: "desc" },
			select: {
				id: true,
				title: true,
				status: true,
				location: true,
				remotePolicy: true,
				employmentType: true,
				publishedAt: true,
				createdAt: true
			}
		});

		response.json({ data: jobs });
	}
);