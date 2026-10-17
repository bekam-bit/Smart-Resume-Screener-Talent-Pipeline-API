import nodemailer from "nodemailer";
import { Resend } from "resend";
import { env } from "../config/env.js";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : undefined;

const mailtrapTransport =
  env.MAILTRAP_USER && env.MAILTRAP_PASS
    ? nodemailer.createTransport({
        host: env.MAILTRAP_HOST,
        port: env.MAILTRAP_PORT,
        auth: {
          user: env.MAILTRAP_USER,
          pass: env.MAILTRAP_PASS
        }
      })
    : undefined;

export const sendEmail = async (input: { to: string; subject: string; html: string; text: string }) => {
  // If Mailtrap is configured, send via Mailtrap Sandbox (works for any recipient email)
  if (mailtrapTransport) {
    await mailtrapTransport.sendMail({
      from: env.EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text
    });
    return;
  }

  if (!resend) {
    throw new Error("Neither MAILTRAP nor RESEND_API_KEY is configured");
  }

  const result = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text
  });

  if (result.error) {
    throw new Error(`Resend delivery failed: ${result.error.message}`);
  }
};

// ─────────────────────────────────────────────────────────────
//  Shared layout wrapper (email-client-safe inline CSS)
// ─────────────────────────────────────────────────────────────
const emailLayout = (content: string) => /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Smart Resume Screener</title>
</head>
<body style="margin:0;padding:0;background:#0f1117;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- ── Header ── -->
          <tr>
            <td style="
              background:linear-gradient(135deg,#1e2035 0%,#16192b 100%);
              border-radius:16px 16px 0 0;
              padding:32px 40px 24px;
              text-align:center;
              border:1px solid #ffffff0f;
              border-bottom:none;
            ">
              <div style="display:inline-flex;align-items:center;gap:10px;margin-bottom:8px;">
                <div style="
                  width:36px;height:36px;
                  background:linear-gradient(135deg,#6366f1,#8b5cf6);
                  border-radius:9px;
                  display:inline-block;
                  line-height:36px;
                  text-align:center;
                  font-size:18px;
                ">🔍</div>
                <span style="font-size:17px;font-weight:700;color:#e2e8f0;letter-spacing:-0.4px;">
                  Smart<span style="color:#818cf8;">Resume</span> Screener
                </span>
              </div>
            </td>
          </tr>

          <!-- ── Body ── -->
          <tr>
            <td style="
              background:#13172200;
              background:linear-gradient(180deg,#1a1e32 0%,#131726 100%);
              padding:36px 40px 32px;
              border-left:1px solid #ffffff0f;
              border-right:1px solid #ffffff0f;
            ">
              ${content}
            </td>
          </tr>

          <!-- ── Footer ── -->
          <tr>
            <td style="
              background:#0d1020;
              border-radius:0 0 16px 16px;
              padding:20px 40px;
              text-align:center;
              border:1px solid #ffffff0f;
              border-top:1px solid #ffffff12;
            ">
              <p style="margin:0 0 6px;font-size:11px;color:#475569;line-height:1.5;">
                You're receiving this email because an action was taken on your Smart Resume Screener account.<br/>
                If you didn't request this, you can safely ignore this email.
              </p>
              <p style="margin:0;font-size:11px;color:#334155;">
                © ${new Date().getFullYear()} Smart Resume Screener · All rights reserved
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

// ─────────────────────────────────────────────────────────────
//  Email Verification template
// ─────────────────────────────────────────────────────────────
const verificationHtml = (email: string, url: string) =>
  emailLayout(/* html */ `
    <h1 style="margin:0 0 10px;font-size:24px;font-weight:800;color:#e2e8f0;letter-spacing:-0.6px;">
      Verify your email address
    </h1>
    <p style="margin:0 0 24px;font-size:14px;color:#94a3b8;line-height:1.65;">
      Hi there! You're almost ready to use Smart Resume Screener. 
      Click the button below to verify <strong style="color:#c7d2fe;">${email}</strong> and activate your account.
    </p>

    <!-- CTA Button -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td align="center">
          <a href="${url}" target="_blank" style="
            display:inline-block;
            padding:14px 36px;
            background:linear-gradient(135deg,#6366f1,#8b5cf6);
            color:#ffffff;
            font-size:15px;
            font-weight:700;
            text-decoration:none;
            border-radius:10px;
            letter-spacing:-0.2px;
            box-shadow:0 4px 20px rgba(99,102,241,0.4);
          ">✓ &nbsp;Verify Email Address</a>
        </td>
      </tr>
    </table>

    <!-- Expiry notice -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td style="
          background:rgba(99,102,241,0.08);
          border:1px solid rgba(99,102,241,0.2);
          border-radius:8px;
          padding:12px 16px;
        ">
          <p style="margin:0;font-size:12.5px;color:#a5b4fc;line-height:1.5;">
            ⏱ <strong>This link expires in 15 minutes.</strong> 
            If it expires, you can request a new verification email from the login page.
          </p>
        </td>
      </tr>
    </table>

    <!-- URL fallback -->
    <p style="margin:0 0 6px;font-size:12px;color:#475569;">
      If the button doesn't work, copy and paste this URL into your browser:
    </p>
    <p style="
      margin:0;
      font-size:11px;
      color:#6366f1;
      word-break:break-all;
      font-family:monospace;
      background:#0f1117;
      padding:10px 12px;
      border-radius:6px;
      border:1px solid #1e2035;
    ">${url}</p>
  `);

// ─────────────────────────────────────────────────────────────
//  Password Reset template
// ─────────────────────────────────────────────────────────────
const passwordResetHtml = (email: string, url: string) =>
  emailLayout(/* html */ `
    <h1 style="margin:0 0 10px;font-size:24px;font-weight:800;color:#e2e8f0;letter-spacing:-0.6px;">
      Reset your password
    </h1>
    <p style="margin:0 0 24px;font-size:14px;color:#94a3b8;line-height:1.65;">
      We received a request to reset the password for 
      <strong style="color:#c7d2fe;">${email}</strong>.
      Click the button below to choose a new password.
    </p>

    <!-- CTA Button -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td align="center">
          <a href="${url}" target="_blank" style="
            display:inline-block;
            padding:14px 36px;
            background:linear-gradient(135deg,#7c3aed,#6366f1);
            color:#ffffff;
            font-size:15px;
            font-weight:700;
            text-decoration:none;
            border-radius:10px;
            letter-spacing:-0.2px;
            box-shadow:0 4px 20px rgba(124,58,237,0.4);
          ">🛡️ &nbsp;Reset My Password</a>
        </td>
      </tr>
    </table>

    <!-- Expiry + security warnings -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr>
        <td style="
          background:rgba(245,158,11,0.08);
          border:1px solid rgba(245,158,11,0.25);
          border-radius:8px;
          padding:12px 16px;
          margin-bottom:12px;
        ">
          <p style="margin:0 0 6px;font-size:12.5px;color:#fcd34d;font-weight:600;">
            ⏱ This link expires in 15 minutes
          </p>
          <p style="margin:0;font-size:12px;color:#a16207;line-height:1.5;">
            After resetting, all existing login sessions will be revoked for your security.
          </p>
        </td>
      </tr>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td style="
          background:rgba(239,68,68,0.07);
          border:1px solid rgba(239,68,68,0.2);
          border-radius:8px;
          padding:12px 16px;
        ">
          <p style="margin:0;font-size:12px;color:#fca5a5;line-height:1.5;">
            🔒 <strong>Didn't request this?</strong> 
            Your password has <em>not</em> been changed. You can safely ignore this email. 
            If you're concerned, consider changing your password proactively.
          </p>
        </td>
      </tr>
    </table>

    <!-- URL fallback -->
    <p style="margin:0 0 6px;font-size:12px;color:#475569;">
      If the button doesn't work, copy and paste this URL into your browser:
    </p>
    <p style="
      margin:0;
      font-size:11px;
      color:#8b5cf6;
      word-break:break-all;
      font-family:monospace;
      background:#0f1117;
      padding:10px 12px;
      border-radius:6px;
      border:1px solid #1e2035;
    ">${url}</p>
  `);

// ─────────────────────────────────────────────────────────────
//  Exported senders
//  Both email types resolve to the same demo page (auth-demo.html)
//  distinguished by the ?type= query param so the UI auto-routes
// ─────────────────────────────────────────────────────────────
export const renderVerificationEmail = (email: string, token: string) => {
  const url = `${env.FRONTEND_APP_URL}/auth-demo.html?token=${encodeURIComponent(token)}&type=verify`;
  return {
    recipient: email,
    subject: "Verify your Smart Resume Screener account",
    bodyHtml: verificationHtml(email, url),
    bodyText: [
      "Verify your Smart Resume Screener account",
      "",
      `Hi! Click the link below to verify ${email} and activate your account.`,
      "This link expires in 15 minutes.",
      "",
      url,
      "",
      "If you didn't create an account, you can safely ignore this email."
    ].join("\n")
  };
};

export const renderPasswordResetEmail = (email: string, token: string) => {
  const url = `${env.FRONTEND_APP_URL}/auth-demo.html?token=${encodeURIComponent(token)}&type=reset`;
  return {
    recipient: email,
    subject: "Reset your Smart Resume Screener password",
    bodyHtml: passwordResetHtml(email, url),
    bodyText: [
      "Reset your Smart Resume Screener password",
      "",
      `We received a password reset request for ${email}.`,
      "Click the link below to set a new password. It expires in 15 minutes.",
      "After resetting, all existing sessions will be revoked.",
      "",
      url,
      "",
      "If you didn't request this, your password has not been changed — you can safely ignore this email."
    ].join("\n")
  };
};

// ─────────────────────────────────────────────────────────────
//  Organization Invitation & Member Added templates
// ─────────────────────────────────────────────────────────────
const invitationHtml = (
  email: string,
  url: string,
  orgName: string,
  role: string,
  recipientName?: string | null
) => {
  const isRoleAdmin = role.toUpperCase() === "ADMIN";
  const roleLabel = isRoleAdmin ? "Organization Administrator" : "Recruiter";
  const roleBadge = isRoleAdmin ? "👑 Organization Admin" : "🎯 Recruiter";
  const roleColor = isRoleAdmin ? "#f59e0b" : "#38bdf8";

  const description = isRoleAdmin
    ? "As an Organization Administrator, you will have complete administrative authority to configure organization settings, invite and manage team members, manage job openings, and oversee full screening and hiring pipelines."
    : "As a Recruiter, you will have access to create and publish jobs, review candidate resumes, analyze AI-driven candidate match evaluations, curate shortlists, and coordinate interview scheduling.";

  const greeting = recipientName ? `Hi ${recipientName},` : "Hello,";

  return emailLayout(/* html */ `
    <div style="margin-bottom: 20px;">
      <span style="
        display:inline-block;
        padding: 4px 12px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 9999px;
        font-size: 12px;
        font-weight: 600;
        color: ${roleColor};
      ">${roleBadge}</span>
    </div>

    <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#e2e8f0;letter-spacing:-0.6px;">
      Join ${orgName} on Smart Resume Screener
    </h1>
    <p style="margin:0 0 20px;font-size:14px;color:#94a3b8;line-height:1.65;">
      ${greeting} You've been invited to join <strong style="color:#ffffff;">${orgName}</strong> as a <strong style="color:${roleColor};">${roleLabel}</strong>.
    </p>

    <!-- Role description card -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td style="
          background:rgba(255,255,255,0.03);
          border:1px solid rgba(255,255,255,0.08);
          border-left:4px solid ${roleColor};
          border-radius:8px;
          padding:16px 20px;
        ">
          <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#e2e8f0;">
            Role Overview: ${roleLabel}
          </p>
          <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
            ${description}
          </p>
        </td>
      </tr>
    </table>

    <!-- CTA Button -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td align="center">
          <a href="${url}" target="_blank" style="
            display:inline-block;
            padding:14px 36px;
            background:linear-gradient(135deg,#6366f1,#8b5cf6);
            color:#ffffff;
            font-size:15px;
            font-weight:700;
            text-decoration:none;
            border-radius:10px;
            letter-spacing:-0.2px;
            box-shadow:0 4px 20px rgba(99,102,241,0.4);
          ">Accept Invitation & Set Password</a>
        </td>
      </tr>
    </table>

    <!-- Expiry notice -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td style="
          background:rgba(99,102,241,0.08);
          border:1px solid rgba(99,102,241,0.2);
          border-radius:8px;
          padding:12px 16px;
        ">
          <p style="margin:0;font-size:12.5px;color:#a5b4fc;line-height:1.5;">
            ⏱ <strong>This invitation link expires in 15 minutes.</strong> 
            Click the button above to set your password and activate your account.
          </p>
        </td>
      </tr>
    </table>

    <!-- URL fallback -->
    <p style="margin:0 0 6px;font-size:12px;color:#475569;">
      If the button doesn't work, copy and paste this URL into your browser:
    </p>
    <p style="
      margin:0;
      font-size:11px;
      color:#6366f1;
      word-break:break-all;
      font-family:monospace;
      background:#0f1117;
      padding:10px 12px;
      border-radius:6px;
      border:1px solid #1e2035;
    ">${url}</p>
  `);
};

const membershipAddedHtml = (
  email: string,
  loginUrl: string,
  orgName: string,
  role: string,
  recipientName?: string | null
) => {
  const isRoleAdmin = role.toUpperCase() === "ADMIN";
  const roleLabel = isRoleAdmin ? "Organization Administrator" : "Recruiter";
  const roleBadge = isRoleAdmin ? "👑 Organization Admin" : "🎯 Recruiter";
  const roleColor = isRoleAdmin ? "#f59e0b" : "#38bdf8";

  const description = isRoleAdmin
    ? "As an Organization Administrator, you will have complete administrative authority to configure organization settings, invite and manage team members, manage job openings, and oversee full screening and hiring pipelines."
    : "As a Recruiter, you will have access to create and publish jobs, review candidate resumes, analyze AI-driven candidate match evaluations, curate shortlists, and coordinate interview scheduling.";

  const greeting = recipientName ? `Hi ${recipientName},` : "Hello,";

  return emailLayout(/* html */ `
    <div style="margin-bottom: 20px;">
      <span style="
        display:inline-block;
        padding: 4px 12px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 9999px;
        font-size: 12px;
        font-weight: 600;
        color: ${roleColor};
      ">${roleBadge}</span>
    </div>

    <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#e2e8f0;letter-spacing:-0.6px;">
      Welcome to ${orgName}
    </h1>
    <p style="margin:0 0 20px;font-size:14px;color:#94a3b8;line-height:1.65;">
      ${greeting} You have been added to <strong style="color:#ffffff;">${orgName}</strong> as a <strong style="color:${roleColor};">${roleLabel}</strong> on Smart Resume Screener.
    </p>

    <!-- Role description card -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td style="
          background:rgba(255,255,255,0.03);
          border:1px solid rgba(255,255,255,0.08);
          border-left:4px solid ${roleColor};
          border-radius:8px;
          padding:16px 20px;
        ">
          <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#e2e8f0;">
            Role Overview: ${roleLabel}
          </p>
          <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
            ${description}
          </p>
        </td>
      </tr>
    </table>

    <!-- CTA Button -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td align="center">
          <a href="${loginUrl}" target="_blank" style="
            display:inline-block;
            padding:14px 36px;
            background:linear-gradient(135deg,#6366f1,#8b5cf6);
            color:#ffffff;
            font-size:15px;
            font-weight:700;
            text-decoration:none;
            border-radius:10px;
            letter-spacing:-0.2px;
            box-shadow:0 4px 20px rgba(99,102,241,0.4);
          ">Go to Organization Workspace</a>
        </td>
      </tr>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td style="
          background:rgba(99,102,241,0.08);
          border:1px solid rgba(99,102,241,0.2);
          border-radius:8px;
          padding:12px 16px;
        ">
          <p style="margin:0;font-size:12.5px;color:#a5b4fc;line-height:1.5;">
            💡 <strong>Your account is already active.</strong> 
            Sign in with your existing credentials to access ${orgName}.
          </p>
        </td>
      </tr>
    </table>
  `);
};

export const renderInvitationEmail = (
  email: string,
  token: string,
  orgName?: string,
  role: string = "RECRUITER",
  recipientName?: string | null
) => {
  const url = `${env.FRONTEND_APP_URL}/auth-demo.html?token=${encodeURIComponent(token)}&type=reset`;
  const company = orgName || "our organization";
  const isRoleAdmin = role.toUpperCase() === "ADMIN";
  const roleLabel = isRoleAdmin ? "Organization Administrator" : "Recruiter";

  return {
    recipient: email,
    subject: `Invitation to join ${company} as ${roleLabel} on Smart Resume Screener`,
    bodyHtml: invitationHtml(email, url, company, role, recipientName),
    bodyText: [
      `Invitation to join ${company} as ${roleLabel}`,
      "",
      `Hi! You have been invited to join ${company} as a ${roleLabel} on Smart Resume Screener.`,
      isRoleAdmin
        ? "As an Organization Administrator, you will have complete administrative authority to configure organization settings, invite and manage team members, manage job openings, and oversee full screening and hiring pipelines."
        : "As a Recruiter, you will have access to create and publish jobs, review candidate resumes, analyze AI-driven candidate match evaluations, curate shortlists, and coordinate interview scheduling.",
      "",
      "Click the link below to activate your account and set your password:",
      url,
      "",
      "This link expires in 15 minutes."
    ].join("\n")
  };
};

export const renderMemberAddedEmail = (
  email: string,
  orgName: string,
  role: string = "RECRUITER",
  recipientName?: string | null
) => {
  const url = `${env.FRONTEND_APP_URL}/dashboard`;
  const isRoleAdmin = role.toUpperCase() === "ADMIN";
  const roleLabel = isRoleAdmin ? "Organization Administrator" : "Recruiter";

  return {
    recipient: email,
    subject: `You've been added to ${orgName} as ${roleLabel}`,
    bodyHtml: membershipAddedHtml(email, url, orgName, role, recipientName),
    bodyText: [
      `You've been added to ${orgName} as ${roleLabel}`,
      "",
      `Hi! You have been granted membership in ${orgName} as a ${roleLabel} on Smart Resume Screener.`,
      isRoleAdmin
        ? "As an Organization Administrator, you will have complete administrative authority to configure organization settings, invite and manage team members, manage job openings, and oversee full screening and hiring pipelines."
        : "As a Recruiter, you will have access to create and publish jobs, review candidate resumes, analyze AI-driven candidate match evaluations, curate shortlists, and coordinate interview scheduling.",
      "",
      `Sign in with your existing credentials to access ${orgName}:`,
      url
    ].join("\n")
  };
};

export const sendVerificationEmail = (email: string, token: string) => {
  const rendered = renderVerificationEmail(email, token);
  return sendEmail({
    to: rendered.recipient,
    subject: rendered.subject,
    html: rendered.bodyHtml,
    text: rendered.bodyText
  });
};

export const sendPasswordResetEmail = (email: string, token: string) => {
  const rendered = renderPasswordResetEmail(email, token);
  return sendEmail({
    to: rendered.recipient,
    subject: rendered.subject,
    html: rendered.bodyHtml,
    text: rendered.bodyText
  });
};