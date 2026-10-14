import type { ApplicationStatus, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { withDbRetry } from "../../utils/db-retry.js";
import { logger } from "../../utils/logger.js";
import { renderInvitationEmail, renderMemberAddedEmail } from "../../providers/resend.email.js";
import { enqueueEmail } from "./outbox.service.js";

export interface StatusEmailParams {
  candidateEmail: string;
  candidateName: string;
  jobTitle: string;
  organizationName?: string;
  newStatus: ApplicationStatus;
  reason?: string | null;
  applicationId?: string;
}

export interface ShortlistRecruiterNoticeParams {
  organizationId: string;
  jobId: string;
  jobTitle: string;
  shortlistedCount: number;
  averageScore?: number;
  executiveSummaryOverview?: string;
}

export interface OrganizationMemberNoticeParams {
  organizationId: string;
  organizationName: string;
  recipientEmail: string;
  recipientName?: string | null;
  role: "ADMIN" | "RECRUITER";
  isNewUser: boolean;
  token?: string;
}

/**
 * Generates email content and enqueues transactional notification emails
 * to applicants for key status milestones (INTERVIEW, REJECTED, OFFER).
 *
 * NOTE: Shortlisting is an internal talent pipeline staging milestone for recruiter review.
 * Candidate notification is incorporated into the INTERVIEW invitation to eliminate
 * redundant/duplicate messages to applicants.
 */
export const enqueueApplicationStatusEmail = async (
  params: StatusEmailParams,
  tx?: Prisma.TransactionClient
) => {
  const { candidateEmail, candidateName, jobTitle, organizationName, newStatus, reason, applicationId } = params;
  const company = organizationName || "our team";

  let subject = "";
  let bodyHtml = "";
  let bodyText = "";

  switch (newStatus) {
    case "INTERVIEW":
      subject = `Interview Invitation: ${jobTitle} at ${company}`;
      bodyHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">
          <h2 style="color: #0f172a; margin-bottom: 16px;">Interview Invitation: ${jobTitle}</h2>
          <p>Dear ${candidateName},</p>
          <p>Congratulations! Following our comprehensive resume and qualifications screening, your application has been <strong>shortlisted</strong> for the <strong>${jobTitle}</strong> position at ${company}, and we would like to invite you for an interview.</p>
          <p>Our recruiting team was impressed by your profile, and will be in touch shortly with scheduling options and details on what to expect during the interview process.</p>
          ${reason ? `<p style="background: #f1f5f9; padding: 12px; border-left: 4px solid #3b82f6; border-radius: 4px;"><strong>Note from the hiring team:</strong> ${reason}</p>` : ""}
          <p>Thank you for your interest in joining ${company}, and we look forward to speaking with you soon!</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
          <p style="font-size: 13px; color: #64748b;">Talent Acquisition Team | ${company}</p>
        </div>
      `;
      bodyText = `Dear ${candidateName},\n\nCongratulations! Following our screening process, your application has been shortlisted for the ${jobTitle} position at ${company}, and we would like to invite you for an interview.\n\nOur recruiting team will follow up shortly with scheduling options.\n\n${reason ? `Note from the hiring team: ${reason}\n\n` : ""}Best regards,\nTalent Acquisition Team | ${company}`;
      break;

    case "SHORTLISTED":
      // Shortlisting is an internal talent pipeline staging milestone for recruiter review.
      // The candidate-facing notification is incorporated into the INTERVIEW invitation
      // to avoid redundant, duplicate emails to applicants.
      logger.info("applicant_status_email_skipped_internal_milestone", {
        applicationId,
        recipient: candidateEmail,
        status: newStatus
      });
      return null;

    case "REJECTED":
      subject = `Update regarding your application for ${jobTitle}`;
      bodyHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">
          <h2 style="color: #0f172a; margin-bottom: 16px;">Application Update: ${jobTitle}</h2>
          <p>Dear ${candidateName},</p>
          <p>Thank you for taking the time to apply for the <strong>${jobTitle}</strong> position at ${company} and for sharing your background with us.</p>
          <p>After careful evaluation of all applications, we have decided to move forward with candidates whose current experience more closely matches the specific technical requirements for this role.</p>
          ${reason ? `<p style="font-size: 14px; color: #475569; background: #f8fafc; padding: 12px; border-radius: 4px;"><strong>Feedback:</strong> ${reason}</p>` : ""}
          <p>We truly appreciate your interest in our team and wish you every success in your future endeavors.</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
          <p style="font-size: 13px; color: #64748b;">Talent Acquisition Team | ${company}</p>
        </div>
      `;
      bodyText = `Dear ${candidateName},\n\nThank you for applying for the ${jobTitle} position at ${company}.\n\nAfter careful consideration, we have decided to move forward with other candidates whose experience more closely matches our current requirements.\n\n${reason ? `Feedback: ${reason}\n\n` : ""}We wish you the very best in your search.\n\nBest regards,\nTalent Acquisition Team | ${company}`;
      break;

    case "OFFER":
      subject = `Formal Offer: ${jobTitle} at ${company}`;
      bodyHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">
          <h2 style="color: #0f172a; margin-bottom: 16px;">Formal Offer of Employment</h2>
          <p>Dear ${candidateName},</p>
          <p>We are delighted to extend a formal offer of employment for the position of <strong>${jobTitle}</strong> at ${company}!</p>
          <p>Please check your candidate portal or contact your recruiter directly to review the comprehensive offer package.</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
          <p style="font-size: 13px; color: #64748b;">Talent Acquisition Team | ${company}</p>
        </div>
      `;
      bodyText = `Dear ${candidateName},\n\nWe are delighted to extend a formal offer of employment for the ${jobTitle} position at ${company}!\n\nPlease check your candidate portal or reach out to your recruiter for the full details.\n\nBest regards,\nTalent Acquisition Team | ${company}`;
      break;

    default:
      // Other internal statuses (e.g. SCREENING, IN_REVIEW) do not trigger candidate emails
      return null;
  }

  try {
    const entry = await enqueueEmail(
      {
        recipient: candidateEmail,
        subject,
        bodyHtml,
        bodyText,
        metadata: {
          applicationId,
          jobTitle,
          status: newStatus,
          recipientType: "CANDIDATE"
        }
      },
      tx
    );

    logger.info("applicant_status_email_enqueued", {
      applicationId,
      recipient: candidateEmail,
      status: newStatus,
      outboxId: entry.id
    });

    return entry;
  } catch (error) {
    logger.error("applicant_status_email_enqueue_error", {
      applicationId,
      recipient: candidateEmail,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
};

/**
 * Notifies organization recruiters/admins when candidate shortlisting has completed.
 */
export const notifyRecruitersShortlistReady = async (
  params: ShortlistRecruiterNoticeParams,
  tx?: Prisma.TransactionClient
) => {
  const { organizationId, jobId, jobTitle, shortlistedCount, averageScore, executiveSummaryOverview } = params;

  try {
    // Find organization members with recruiter/admin roles
    const memberships = await withDbRetry(() =>
      prisma.organizationMembership.findMany({
        where: {
          organizationId,
          role: { in: ["ADMIN", "RECRUITER"] },
          status: "ACTIVE"
        },
        select: { userId: true }
      })
    );

    if (memberships.length === 0) {
      return [];
    }

    const userIds = memberships.map((m) => m.userId);
    const recruiters = await withDbRetry(() =>
      prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { email: true }
      })
    );

    if (recruiters.length === 0) {
      return [];
    }

    const subject = `Shortlist Ready: ${jobTitle} (${shortlistedCount} candidate${shortlistedCount === 1 ? "" : "s"})`;
    const bodyHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">
        <h2 style="color: #0f172a; margin-bottom: 16px;">Candidate Shortlist Completed</h2>
        <p>A candidate shortlist has been processed for <strong>${jobTitle}</strong>.</p>
        <ul style="background: #f8fafc; padding: 16px 24px; border-radius: 6px; list-style: square;">
          <li><strong>Shortlisted Candidates:</strong> ${shortlistedCount}</li>
          ${averageScore !== undefined ? `<li><strong>Average Match Score:</strong> ${averageScore}%</li>` : ""}
        </ul>
        ${
          executiveSummaryOverview
            ? `<div style="background: #eff6ff; padding: 14px; border-left: 4px solid #3b82f6; border-radius: 4px; margin: 16px 0;">
                 <h4 style="margin: 0 0 6px 0; color: #1e40af;">Executive AI Summary:</h4>
                 <p style="margin: 0; color: #1e3a8a;">${executiveSummaryOverview}</p>
               </div>`
            : ""
        }
        <p>Please log in to your recruiter portal to review the ranked candidate breakdown, inspect evidence, and schedule interviews.</p>
      </div>
    `;

    const bodyText = `Candidate Shortlist Completed: ${jobTitle}\n\nShortlisted Candidates: ${shortlistedCount}\n${averageScore !== undefined ? `Average Match: ${averageScore}%\n` : ""}\n${executiveSummaryOverview ? `Summary: ${executiveSummaryOverview}\n\n` : ""}Log in to review candidates and sequence interviews.`;

    const enqueued = [];
    for (const rec of recruiters) {
      const entry = await enqueueEmail(
        {
          recipient: rec.email,
          subject,
          bodyHtml,
          bodyText,
          metadata: {
            organizationId,
            jobId,
            recipientType: "RECRUITER",
            shortlistedCount
          }
        },
        tx
      );
      enqueued.push(entry);
    }

    return enqueued;
  } catch (error) {
    logger.warn("recruiter_shortlist_notice_error", {
      jobId,
      organizationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
};

/**
 * Enqueues a transactional email when a member is invited (new user) or added (existing user)
 * to an organization with a specific role (ADMIN or RECRUITER).
 */
export const enqueueOrganizationMemberNoticeEmail = async (
  params: OrganizationMemberNoticeParams,
  tx?: Prisma.TransactionClient
) => {
  const { organizationId, organizationName, recipientEmail, recipientName, role, isNewUser, token } = params;

  let rendered;
  if (isNewUser && token) {
    rendered = renderInvitationEmail(recipientEmail, token, organizationName, role, recipientName);
  } else {
    rendered = renderMemberAddedEmail(recipientEmail, organizationName, role, recipientName);
  }

  try {
    const entry = await enqueueEmail(
      {
        recipient: rendered.recipient,
        subject: rendered.subject,
        bodyHtml: rendered.bodyHtml,
        bodyText: rendered.bodyText,
        metadata: {
          organizationId,
          organizationName,
          role,
          isNewUser,
          recipientType: isNewUser ? "MEMBER_INVITATION" : "MEMBER_ADDED"
        }
      },
      tx
    );

    logger.info("organization_member_email_enqueued", {
      organizationId,
      recipient: recipientEmail,
      role,
      isNewUser,
      outboxId: entry.id
    });

    return entry;
  } catch (error) {
    logger.error("organization_member_email_enqueue_error", {
      organizationId,
      recipient: recipientEmail,
      role,
      isNewUser,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
};

