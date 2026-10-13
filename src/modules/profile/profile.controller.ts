import type { Request, Response } from "express";
import { AppError } from "../../utils/app-error.js";
import { parseOrThrow } from "../../middlewares/validate-request.js";
import { paginationSchema, respondList } from "../../schemas/common.schema.js";
import { resumeIdParamSchema, updateProfileSchema } from "./profile.schemas.js";
import { deleteResume, getProfile, getResumeAccess, listResumes, updateProfile, uploadResume } from "./profile.service.js";

const actorId = (request: Request) => {
  if (!request.userId) throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
  return request.userId;
};

export const getProfileController = async (request: Request, response: Response) => {
  const profile = await getProfile(actorId(request));
  response.json({ profile });
};

export const updateProfileController = async (request: Request, response: Response) => {
  const profile = await updateProfile(actorId(request), parseOrThrow(updateProfileSchema, request.body));
  response.json({ profile });
};

export const listResumesController = async (request: Request, response: Response) => {
  const pagination = parseOrThrow(paginationSchema, request.query);
  const { total, resumes } = await listResumes(actorId(request), pagination);
  respondList(response, resumes, pagination, total);
};

export const uploadResumeController = async (request: Request, response: Response) => {
  const file = request.file;
  if (!file) throw new AppError("FILE_REQUIRED", "A resume file is required (field name: resume)", 400);
  const resume = await uploadResume(actorId(request), file);
  response.status(201).json({ resume });
};

export const getResumeController = async (request: Request, response: Response) => {
  const { resumeId } = parseOrThrow(resumeIdParamSchema, request.params);
  const { resume, downloadUrl } = await getResumeAccess(actorId(request), resumeId);
  response.json({ resume, downloadUrl });
};

export const deleteResumeController = async (request: Request, response: Response) => {
  const { resumeId } = parseOrThrow(resumeIdParamSchema, request.params);
  await deleteResume(actorId(request), resumeId);
  response.status(204).send();
};
