"use client";

import { useRef, useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import { splitList } from "@/lib/format";
import {
  REMOTE_PREFERENCES,
  type CandidateProfile,
  type Preferences,
  type ProfileSettings,
  type ProfileView,
  type RemotePreference,
  type ScreeningAnswers,
} from "@/lib/types";
import type { ProfilePatch } from "@/lib/validation";
import { PlusIcon, TrashIcon, UploadIcon } from "./icons";
import { Toaster, useToasts } from "./Toaster";
import { Button, Card, Field, controlClass } from "./ui";

const REMOTE_LABELS: Record<RemotePreference, string> = {
  any: "Remote or on-site",
  remote_only: "Remote only",
  onsite_ok: "On-site / hybrid preferred",
};

function Section({
  title,
  description,
  children,
  onSave,
  saving,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  onSave?: () => void;
  saving?: boolean;
}) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>
        </div>
        {onSave && (
          <Button variant="primary" onClick={onSave} loading={saving}>
            Save
          </Button>
        )}
      </div>
      {children}
    </Card>
  );
}

export function ProfileEditor({ initial }: { initial: ProfileView }) {
  const [view, setView] = useState(initial);
  const [profile, setProfile] = useState<CandidateProfile | null>(initial.profile);
  const [skillsText, setSkillsText] = useState(initial.profile?.skills.join(", ") ?? "");
  const [preferences, setPreferences] = useState<Preferences>(initial.preferences);
  const [prefText, setPrefText] = useState({
    titles: initial.preferences.titles.join(", "),
    locations: initial.preferences.locations.join(", "),
    excludeKeywords: initial.preferences.excludeKeywords.join(", "),
  });
  const [answers, setAnswers] = useState<ScreeningAnswers>(initial.answers);
  const [settings, setSettings] = useState<ProfileSettings>(initial.settings);
  const [saving, setSaving] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { toasts, notify, dismiss } = useToasts();

  function adopt(next: ProfileView) {
    setView(next);
    setProfile(next.profile);
    setSkillsText(next.profile?.skills.join(", ") ?? "");
  }

  async function save(section: string, patch: ProfilePatch) {
    setSaving(section);
    try {
      adopt(await api.updateProfile(patch));
      notify("success", "Saved");
    } catch (error) {
      notify("error", error instanceof ApiError ? error.message : "Could not save");
    } finally {
      setSaving(null);
    }
  }

  async function upload(file: File) {
    setUploading(true);
    try {
      adopt(await api.uploadResume(file));
      notify("success", "Resume read - check the details below");
    } catch (error) {
      notify("error", error instanceof ApiError ? error.message : "Could not read that resume");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const text = (key: keyof CandidateProfile) => ({
    value: String(profile?.[key] ?? ""),
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      profile && setProfile({ ...profile, [key]: event.target.value }),
  });

  const answer = (key: Exclude<keyof ScreeningAnswers, "custom">) => ({
    value: answers[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => setAnswers({ ...answers, [key]: event.target.value }),
  });

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Everything the matcher and the application forms draw on. Nothing here is ever made up - if a form asks
          something these answers do not cover, the application comes back to you.
        </p>
      </div>

      <Section title="Resume" description="PDF, Word (.docx) or plain text, up to 5 MB. It is attached to every application.">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.docx,.txt,.md,application/pdf"
            className="sr-only"
            id="resume-file"
            onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])}
          />
          <Button variant="primary" onClick={() => fileInput.current?.click()} loading={uploading}>
            {!uploading && <UploadIcon className="size-4" />}
            {uploading ? "Reading your resume..." : view.hasResume ? "Replace resume" : "Upload resume"}
          </Button>
          {view.resumeFilename && <span className="text-sm text-slate-600 dark:text-slate-300">{view.resumeFilename}</span>}
        </div>
      </Section>

      {profile && (
        <Section
          title="About you"
          description="Extracted from your resume. Fix anything the AI got wrong."
          onSave={() => save("profile", { profile: { ...profile, skills: splitList(skillsText) } })}
          saving={saving === "profile"}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="fullName"><input id="fullName" className={controlClass()} {...text("fullName")} /></Field>
            <Field label="Headline" htmlFor="headline"><input id="headline" className={controlClass()} {...text("headline")} /></Field>
            <Field label="Email" htmlFor="pemail"><input id="pemail" className={controlClass()} {...text("email")} /></Field>
            <Field label="Phone" htmlFor="phone"><input id="phone" className={controlClass()} {...text("phone")} /></Field>
            <Field label="Location" htmlFor="plocation"><input id="plocation" className={controlClass()} {...text("location")} /></Field>
            <Field label="Years of experience" htmlFor="years">
              <input id="years" type="number" min={0} max={70} className={controlClass()} value={profile.yearsExperience}
                onChange={(event) => setProfile({ ...profile, yearsExperience: Number(event.target.value) || 0 })} />
            </Field>
            <Field label="Summary" htmlFor="summary" className="sm:col-span-2">
              <textarea id="summary" rows={3} className={controlClass()} {...text("summary")} />
            </Field>
            <Field label="Skills" htmlFor="skills" hint="Comma separated" className="sm:col-span-2">
              <textarea id="skills" rows={2} className={controlClass()} value={skillsText} onChange={(event) => setSkillsText(event.target.value)} />
            </Field>
          </div>
          {profile.experience.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold">Experience</h3>
              <ul className="mt-2 flex flex-col gap-3">
                {profile.experience.map((role, index) => (
                  <li key={index} className="text-sm">
                    <p className="font-medium">{role.title} · {role.company}</p>
                    <p className="text-xs text-slate-500">{role.start} - {role.end}</p>
                    <ul className="mt-1 list-disc pl-5 text-slate-600 dark:text-slate-300">
                      {role.highlights.map((highlight, i) => <li key={i}>{highlight}</li>)}
                    </ul>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-500">To change your experience, update your resume and upload it again.</p>
            </div>
          )}
        </Section>
      )}

      <Section
        title="What you're looking for"
        description="Postings that clearly miss these are filtered out before anything is scored."
        onSave={() =>
          save("preferences", {
            preferences: {
              ...preferences,
              titles: splitList(prefText.titles),
              locations: splitList(prefText.locations),
              excludeKeywords: splitList(prefText.excludeKeywords),
            },
          })
        }
        saving={saving === "preferences"}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Target job titles" htmlFor="titles" hint="Comma separated, e.g. Frontend Engineer, UI Engineer" className="sm:col-span-2">
            <input id="titles" className={controlClass()} value={prefText.titles} onChange={(event) => setPrefText({ ...prefText, titles: event.target.value })} />
          </Field>
          <Field label="Locations" htmlFor="locations" hint="Leave empty for anywhere">
            <input id="locations" className={controlClass()} value={prefText.locations} onChange={(event) => setPrefText({ ...prefText, locations: event.target.value })} />
          </Field>
          <Field label="Remote" htmlFor="remote">
            <select id="remote" className={controlClass()} value={preferences.remote}
              onChange={(event) => setPreferences({ ...preferences, remote: event.target.value as RemotePreference })}>
              {REMOTE_PREFERENCES.map((value) => <option key={value} value={value}>{REMOTE_LABELS[value]}</option>)}
            </select>
          </Field>
          <Field label="Seniority" htmlFor="seniority" hint="e.g. Senior, Staff, Mid-level">
            <input id="seniority" className={controlClass()} value={preferences.seniority} onChange={(event) => setPreferences({ ...preferences, seniority: event.target.value })} />
          </Field>
          <Field label="Minimum base salary" htmlFor="minSalary">
            <input id="minSalary" type="number" min={0} step={1000} className={controlClass()} value={preferences.minSalary ?? ""}
              onChange={(event) => setPreferences({ ...preferences, minSalary: event.target.value ? Number(event.target.value) : null })} />
          </Field>
          <Field label="Exclude postings mentioning" htmlFor="exclude" hint="Comma separated, e.g. intern, clearance" className="sm:col-span-2">
            <input id="exclude" className={controlClass()} value={prefText.excludeKeywords} onChange={(event) => setPrefText({ ...prefText, excludeKeywords: event.target.value })} />
          </Field>
          <Field label="Anything else the matcher should know" htmlFor="notes" className="sm:col-span-2">
            <textarea id="notes" rows={2} className={controlClass()} value={preferences.notes} placeholder="Prefer climate or health tech; no agencies"
              onChange={(event) => setPreferences({ ...preferences, notes: event.target.value })} />
          </Field>
        </div>
      </Section>

      <Section
        title="Screening answers"
        description="Used word for word when an application form asks. Leave a field blank and that question comes back to you instead."
        onSave={() => save("answers", { answers: { ...answers, custom: answers.custom.filter((entry) => entry.question.trim()) } })}
        saving={saving === "answers"}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Authorized to work in the country of the job?" htmlFor="auth"><input id="auth" placeholder="Yes" className={controlClass()} {...answer("workAuthorization")} /></Field>
          <Field label="Need visa sponsorship?" htmlFor="sponsor"><input id="sponsor" placeholder="No" className={controlClass()} {...answer("requiresSponsorship")} /></Field>
          <Field label="Salary expectation" htmlFor="salary"><input id="salary" placeholder="$150,000" className={controlClass()} {...answer("salaryExpectation")} /></Field>
          <Field label="Notice period / start date" htmlFor="notice"><input id="notice" placeholder="2 weeks" className={controlClass()} {...answer("noticePeriod")} /></Field>
          <Field label="Willing to relocate?" htmlFor="relocate"><input id="relocate" className={controlClass()} {...answer("willingToRelocate")} /></Field>
          <Field label="Pronouns" htmlFor="pronouns"><input id="pronouns" className={controlClass()} {...answer("pronouns")} /></Field>
          <Field label="LinkedIn URL" htmlFor="linkedin"><input id="linkedin" className={controlClass()} {...answer("linkedin")} /></Field>
          <Field label="GitHub URL" htmlFor="github"><input id="github" className={controlClass()} {...answer("github")} /></Field>
          <Field label="Website / portfolio" htmlFor="website" className="sm:col-span-2"><input id="website" className={controlClass()} {...answer("website")} /></Field>
        </div>

        <div className="mt-5 flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Other questions you get asked</h3>
          {answers.custom.map((entry, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <input aria-label="Question" placeholder="Question, e.g. Years of React experience" className={controlClass()} value={entry.question}
                onChange={(event) => setAnswers({ ...answers, custom: answers.custom.map((item, i) => (i === index ? { ...item, question: event.target.value } : item)) })} />
              <input aria-label="Answer" placeholder="Answer" className={controlClass()} value={entry.answer}
                onChange={(event) => setAnswers({ ...answers, custom: answers.custom.map((item, i) => (i === index ? { ...item, answer: event.target.value } : item)) })} />
              <Button variant="ghost" aria-label="Remove question" onClick={() => setAnswers({ ...answers, custom: answers.custom.filter((_, i) => i !== index) })}>
                <TrashIcon className="size-4" />
              </Button>
            </div>
          ))}
          <div>
            <Button onClick={() => setAnswers({ ...answers, custom: [...answers.custom, { question: "", answer: "" }] })}>
              <PlusIcon className="size-4" /> Add question
            </Button>
          </div>
        </div>
      </Section>

      <Section
        title="Automation"
        description="How much ApplyPilot does without asking."
        onSave={() => save("settings", { settings })}
        saving={saving === "settings"}
      >
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-indigo-600" checked={settings.autoApply}
            onChange={(event) => setSettings({ ...settings, autoApply: event.target.checked })} />
          <span>
            <span className="font-medium">Auto-apply to strong matches</span>
            <span className="block text-slate-500 dark:text-slate-400">
              Postings on Greenhouse and Lever that score at or above the threshold are submitted without review.
              Everything else still waits in your queue.
            </span>
          </span>
        </label>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Auto-apply at score" htmlFor="autoMin">
            <input id="autoMin" type="number" min={0} max={100} className={controlClass()} value={settings.autoApplyMinScore}
              onChange={(event) => setSettings({ ...settings, autoApplyMinScore: Number(event.target.value) })} />
          </Field>
          <Field label="Show for review at score" htmlFor="reviewMin">
            <input id="reviewMin" type="number" min={0} max={100} className={controlClass()} value={settings.reviewMinScore}
              onChange={(event) => setSettings({ ...settings, reviewMinScore: Number(event.target.value) })} />
          </Field>
          <Field label="Max applications per day" htmlFor="daily">
            <input id="daily" type="number" min={0} max={100} className={controlClass()} value={settings.dailyApplyLimit}
              onChange={(event) => setSettings({ ...settings, dailyApplyLimit: Number(event.target.value) })} />
          </Field>
        </div>
      </Section>

      <Toaster toasts={toasts} onDismiss={dismiss} />
    </main>
  );
}
