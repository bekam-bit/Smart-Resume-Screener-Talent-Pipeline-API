import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  enqueueApplicationStatusEmail,
  enqueueOrganizationMemberNoticeEmail
} from "../../src/modules/notifications/applicant-notifications.service.js";
import * as outboxService from "../../src/modules/notifications/outbox.service.js";
import {
  renderInvitationEmail,
  renderMemberAddedEmail
} from "../../src/providers/resend.email.js";

describe("Applicant and Organization Notifications (Unit)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("renderInvitationEmail", () => {
    it("renders invitation email for a new RECRUITER with password setup token link", () => {
      const rendered = renderInvitationEmail(
        "recruiter@example.com",
        "mock-invite-token-123",
        "Acme Corp",
        "RECRUITER",
        "Jane Recruiter"
      );

      expect(rendered.recipient).toBe("recruiter@example.com");
      expect(rendered.subject).toBe("Invitation to join Acme Corp as Recruiter on Smart Resume Screener");
      expect(rendered.bodyHtml).toContain("Acme Corp");
      expect(rendered.bodyHtml).toContain("Recruiter");
      expect(rendered.bodyHtml).toContain("mock-invite-token-123");
      expect(rendered.bodyHtml).toContain("Jane Recruiter");
      expect(rendered.bodyText).toContain("mock-invite-token-123");
      expect(rendered.bodyText).toContain("As a Recruiter, you will have access");
    });

    it("renders invitation email for a new ADMIN with administrative description", () => {
      const rendered = renderInvitationEmail(
        "admin@example.com",
        "admin-invite-token-456",
        "Acme Corp",
        "ADMIN",
        "Alex Admin"
      );

      expect(rendered.recipient).toBe("admin@example.com");
      expect(rendered.subject).toBe("Invitation to join Acme Corp as Organization Administrator on Smart Resume Screener");
      expect(rendered.bodyHtml).toContain("Organization Administrator");
      expect(rendered.bodyHtml).toContain("admin-invite-token-456");
      expect(rendered.bodyText).toContain("Organization Administrator");
      expect(rendered.bodyText).toContain("complete administrative authority");
    });
  });

  describe("renderMemberAddedEmail", () => {
    it("renders member added notice for an existing user added as RECRUITER", () => {
      const rendered = renderMemberAddedEmail(
        "existing@example.com",
        "Globex Corp",
        "RECRUITER",
        "Bob Talent"
      );

      expect(rendered.recipient).toBe("existing@example.com");
      expect(rendered.subject).toBe("You've been added to Globex Corp as Recruiter");
      expect(rendered.bodyHtml).toContain("Globex Corp");
      expect(rendered.bodyHtml).toContain("Recruiter");
      expect(rendered.bodyText).toContain("/dashboard");
    });

    it("renders member added notice for an existing user added/promoted as ADMIN", () => {
      const rendered = renderMemberAddedEmail(
        "promoted@example.com",
        "Globex Corp",
        "ADMIN",
        "Carol Leader"
      );

      expect(rendered.recipient).toBe("promoted@example.com");
      expect(rendered.subject).toBe("You've been added to Globex Corp as Organization Administrator");
      expect(rendered.bodyHtml).toContain("Organization Administrator");
      expect(rendered.bodyText).toContain("complete administrative authority");
    });
  });

  describe("enqueueApplicationStatusEmail - Candidate Milestones & Shortlist Deduplication", () => {
    it("enqueues an INTERVIEW email containing both shortlisted recognition and interview invitation", async () => {
      const enqueueSpy = vi.spyOn(outboxService, "enqueueEmail").mockResolvedValue({
        id: "outbox-interview-1",
        recipient: "candidate@example.com",
        subject: "Interview Invitation: Lead Engineer at Acme Corp",
        bodyHtml: "<p>Interview</p>",
        bodyText: "Interview",
        metadata: {},
        status: "PENDING",
        attempts: 0,
        lastError: null,
        nextAttemptAt: new Date(),
        maxAttempts: 5,
        sentAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const result = await enqueueApplicationStatusEmail({
        candidateEmail: "candidate@example.com",
        candidateName: "Dev Candidate",
        jobTitle: "Lead Engineer",
        organizationName: "Acme Corp",
        newStatus: "INTERVIEW",
        reason: "Excellent technical assessment performance",
        applicationId: "app-123"
      });

      expect(result).not.toBeNull();
      expect(enqueueSpy).toHaveBeenCalledTimes(1);

      const callArgs = enqueueSpy.mock.calls[0]![0];
      expect(callArgs.recipient).toBe("candidate@example.com");
      expect(callArgs.subject).toBe("Interview Invitation: Lead Engineer at Acme Corp");
      // Must consolidate shortlist and interview messaging
      expect(callArgs.bodyHtml).toContain("shortlisted");
      expect(callArgs.bodyHtml).toContain("invite you for an interview");
      expect(callArgs.bodyHtml).toContain("Excellent technical assessment performance");
      expect(callArgs.metadata).toMatchObject({
        applicationId: "app-123",
        status: "INTERVIEW"
      });
    });

    it("returns null and DOES NOT enqueue an email for SHORTLISTED (internal recruiter milestone)", async () => {
      const enqueueSpy = vi.spyOn(outboxService, "enqueueEmail");

      const result = await enqueueApplicationStatusEmail({
        candidateEmail: "candidate@example.com",
        candidateName: "Dev Candidate",
        jobTitle: "Lead Engineer",
        organizationName: "Acme Corp",
        newStatus: "SHORTLISTED",
        applicationId: "app-123"
      });

      // Crucial verification: SHORTLISTED must NOT generate an outbox email
      expect(result).toBeNull();
      expect(enqueueSpy).not.toHaveBeenCalled();
    });

    it("enqueues a REJECTED status email with feedback if provided", async () => {
      const enqueueSpy = vi.spyOn(outboxService, "enqueueEmail").mockResolvedValue({
        id: "outbox-rejected-1",
        recipient: "candidate@example.com",
        subject: "Update regarding your application",
        bodyHtml: "<p>Rejected</p>",
        bodyText: "Rejected",
        metadata: {},
        status: "PENDING",
        attempts: 0,
        lastError: null,
        nextAttemptAt: new Date(),
        maxAttempts: 5,
        sentAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const result = await enqueueApplicationStatusEmail({
        candidateEmail: "candidate@example.com",
        candidateName: "Dev Candidate",
        jobTitle: "Lead Engineer",
        organizationName: "Acme Corp",
        newStatus: "REJECTED",
        reason: "Role filled by another applicant",
        applicationId: "app-123"
      });

      expect(result).not.toBeNull();
      expect(enqueueSpy).toHaveBeenCalledTimes(1);
      const callArgs = enqueueSpy.mock.calls[0]![0];
      expect(callArgs.subject).toBe("Update regarding your application for Lead Engineer");
      expect(callArgs.bodyHtml).toContain("Role filled by another applicant");
    });
  });

  describe("enqueueOrganizationMemberNoticeEmail", () => {
    it("enqueues an invitation transactional email when isNewUser is true and token is present", async () => {
      const enqueueSpy = vi.spyOn(outboxService, "enqueueEmail").mockResolvedValue({
        id: "outbox-invite-1",
        recipient: "newuser@example.com",
        subject: "Invitation",
        bodyHtml: "<p>Invite</p>",
        bodyText: "Invite",
        metadata: {},
        status: "PENDING",
        attempts: 0,
        lastError: null,
        nextAttemptAt: new Date(),
        maxAttempts: 5,
        sentAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const result = await enqueueOrganizationMemberNoticeEmail({
        organizationId: "org-1",
        organizationName: "Stark Industries",
        recipientEmail: "newuser@example.com",
        recipientName: "Tony Stark",
        role: "ADMIN",
        isNewUser: true,
        token: "stark-secret-token"
      });

      expect(result).not.toBeNull();
      expect(enqueueSpy).toHaveBeenCalledTimes(1);
      const callArgs = enqueueSpy.mock.calls[0]![0];
      expect(callArgs.recipient).toBe("newuser@example.com");
      expect(callArgs.subject).toContain("Invitation to join Stark Industries as Organization Administrator");
      expect(callArgs.bodyHtml).toContain("stark-secret-token");
      expect(callArgs.metadata).toMatchObject({
        organizationId: "org-1",
        organizationName: "Stark Industries",
        role: "ADMIN",
        isNewUser: true,
        recipientType: "MEMBER_INVITATION"
      });
    });

    it("enqueues a member added transactional email when isNewUser is false", async () => {
      const enqueueSpy = vi.spyOn(outboxService, "enqueueEmail").mockResolvedValue({
        id: "outbox-added-1",
        recipient: "existing@example.com",
        subject: "Added",
        bodyHtml: "<p>Added</p>",
        bodyText: "Added",
        metadata: {},
        status: "PENDING",
        attempts: 0,
        lastError: null,
        nextAttemptAt: new Date(),
        maxAttempts: 5,
        sentAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const result = await enqueueOrganizationMemberNoticeEmail({
        organizationId: "org-2",
        organizationName: "Wayne Enterprises",
        recipientEmail: "existing@example.com",
        role: "RECRUITER",
        isNewUser: false
      });

      expect(result).not.toBeNull();
      expect(enqueueSpy).toHaveBeenCalledTimes(1);
      const callArgs = enqueueSpy.mock.calls[0]![0];
      expect(callArgs.recipient).toBe("existing@example.com");
      expect(callArgs.subject).toBe("You've been added to Wayne Enterprises as Recruiter");
      expect(callArgs.metadata).toMatchObject({
        organizationId: "org-2",
        organizationName: "Wayne Enterprises",
        role: "RECRUITER",
        isNewUser: false,
        recipientType: "MEMBER_ADDED"
      });
    });
  });
});
