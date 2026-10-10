export const CROSS_SYSTEM_CONFIG_VERSION = "2026.10.10";
export const CROSS_SYSTEM_MODULE_NAME = "Somatic_MentalHealth_SUD_CrossMapping_Engine";
export const SCOPE_OF_PRACTICE_SAFETY_NOTE = "[SCOPE OF PRACTICE SAFETY NOTE]: The physical symptoms and medical conditions documented above are based entirely on subjective patient self-report during the mental health encounter. The client has been explicitly advised to seek comprehensive medical evaluation, active monitoring, and somatic treatment from a qualified primary care physician or medical specialist, as physical health management falls completely outside the diagnostic and clinical scope of psychotherapy.";

export type CrossSystemRule = {
  id: string;
  category: string;
  keywords: string[];
  primaryLink: string;
  primaryMentalHealthCode: string;
  primaryMentalHealthDescription: string;
  somaticCode: string;
  somaticDescription: string;
  somaticAlternativeCode: string;
  somaticAlternativeDescription: string;
  dotPhrase: string;
  macroText: string;
  emergencyTriggers: string[];
  emergencyAlertText: string;
};

export const CROSS_SYSTEM_RULES: CrossSystemRule[] = [
  {
    id: "SOM-001", category: "Gastrointestinal Distress",
    keywords: ["ibs", "irritable bowel", "acid reflux", "gerd", "stomach pain", "nausea", "cramping"],
    primaryLink: "Generalized Anxiety / Panic Disorder",
    primaryMentalHealthCode: "F41.1", primaryMentalHealthDescription: "Generalized anxiety disorder",
    somaticCode: "K58.9", somaticDescription: "Irritable bowel syndrome without diarrhea",
    somaticAlternativeCode: "R10.9", somaticAlternativeDescription: "Unspecified abdominal pain",
    dotPhrase: ".somaticGI",
    macroText: "Somatic & Mental Health Interaction (Gastrointestinal): The client continues to report significant somatic gastrointestinal distress (IBS/Reflux flares), which demonstrates a clear bi-directional correlation with their autonomic anxiety spikes and panic thresholds. The client notes that cognitive academic or somatic anticipatory anxiety consistently triggers acute physical gastrointestinal distress, which then creates a secondary feedback loop of panic and hyper-fixation on bodily sensations. Interventions utilized somatic grounding, diaphragmatic breathing to regulate vagal nerve tone, and cognitive reframing of body-bound anxiety cues to interrupt the somatic loop. The client's self-reported GI distress rating is logged at [___/10] this week.",
    emergencyTriggers: ["bloody stool", "persistent vomiting", "unexplained severe weight loss"],
    emergencyAlertText: "CLINICAL WARNING: Patient-reported gastrointestinal symptoms include red-flag bleeding or severe physical degradation. Ensure patient is working with a gastroenterologist or primary care physician immediately.",
  },
  {
    id: "SOM-002", category: "Chronic Pain / Musculoskeletal",
    keywords: ["fibromyalgia", "chronic pain", "low back pain", "sciatica", "arthritis", "neck pain"],
    primaryLink: "Major Depression / Opioid Use Disorder / PTSD",
    primaryMentalHealthCode: "F33.1", primaryMentalHealthDescription: "Major depressive disorder, recurrent, moderate",
    somaticCode: "M79.7", somaticDescription: "Fibromyalgia",
    somaticAlternativeCode: "G89.29", somaticAlternativeDescription: "Other chronic pain",
    dotPhrase: ".somaticPain",
    macroText: "Somatic & Mental Health Interaction (Chronic Pain): The client reports that their chronic somatic pain baseline is currently acting as a primary driver of psychological distress. Today's intake/session review indicates that higher subjective pain levels directly exacerbate [depressive withdrawal / opioid cravings / trauma hypervigilance], leading to a drop in functional baseline capabilities. Clinical interventions focused heavily on mindfulness-based pain management, cognitive restructuring of somatic catastrophizing, and building non-chemical distress tolerance skills. The client's self-reported physical pain rating is logged at [___/10] this week.",
    emergencyTriggers: ["sudden loss of bowel control", "saddle anesthesia", "inability to walk"],
    emergencyAlertText: "ACUTE MEDICAL ALERT: Symptoms match spinal cord compression / cauda equina syndrome markers. Instruct the patient to go to the nearest emergency room immediately.",
  },
  {
    id: "SOM-003", category: "Cardiovascular Somatic Cues",
    keywords: ["hypertension", "high blood pressure", "tachycardia", "heart racing", "chest tightness", "palpitations"],
    primaryLink: "Panic Disorder / Severe Illness Anxiety / Alcohol Withdrawal",
    primaryMentalHealthCode: "F41.0", primaryMentalHealthDescription: "Panic disorder [episodic paroxysmal anxiety]",
    somaticCode: "I10", somaticDescription: "Essential (primary) hypertension",
    somaticAlternativeCode: "R00.0", somaticAlternativeDescription: "Tachycardia, unspecified",
    dotPhrase: ".somaticCardio",
    macroText: "Somatic & Mental Health Interaction (Cardiovascular / Panic): The client reports ongoing struggles with physiological cardiovascular symptoms, specifically [elevated heart rate / fluctuating blood pressure], which closely mimic or exacerbate their active panic baseline. Session focused on psychoeducation regarding the sympathetic nervous system's fight-or-flight response to differentiate between panic-induced somatic tracking and acute medical emergencies. Taught interoceptive exposure exercises and progressive muscle relaxation to restore a sense of physical safety. The client's self-reported cardiac distress rating is logged at [___/10] this week.",
    emergencyTriggers: ["chest pain radiating to arm", "jaw pain", "left-sided numbness", "slurred speech"],
    emergencyAlertText: "CRISIS CALL OUT: Physical symptoms match myocardial infarction or acute stroke presentation. Halt session and call 911 immediately.",
  },
  {
    id: "SOM-004", category: "Chronic Substance-Induced Organ Damage",
    keywords: ["cirrhosis", "liver failure", "hepatitis c", "hep c", "kidney damage", "endocarditis"],
    primaryLink: "Chronic Alcohol / Severe Injection Drug Use Disorder",
    primaryMentalHealthCode: "F10.20", primaryMentalHealthDescription: "Alcohol dependence, uncomplicated",
    somaticCode: "K74.60", somaticDescription: "Unspecified cirrhosis of liver",
    somaticAlternativeCode: "B19.20", somaticAlternativeDescription: "Unspecified chronic hepatitis C without hepatic coma",
    dotPhrase: ".somaticSUD",
    macroText: "Somatic & SUD Interaction (Medical Complications): The client presents with ongoing patient-reported medical complications secondary to long-term substance use patterns, specifically tracking [Cirrhosis / Hep C / Chronic Organ Distress]. The physical impact of these chronic health problems significantly complicates their substance recovery track, contributing to [existential depression / low self-efficacy / physical cravings]. Clinical interventions focused on processing the emotional toll of chronic physical illness, utilizing motivational interviewing to sustain sobriety despite physical discomfort, and encouraging active engagement with their medical care team. The client's self-reported physical impact rating is logged at [___/10] this week.",
    emergencyTriggers: ["jaundice", "ascites fluid accumulation", "hepatic encephalopathy confusion", "vomiting blood"],
    emergencyAlertText: "SUD COMPLICATION DANGER: Symptoms indicate advanced liver decompensation or esophageal varices rupture. Recommend immediate emergency hospital evaluation.",
  },
];

export type DiagnosisSuggestion = { code: string; description: string };
export type CombinationSuggestion = DiagnosisSuggestion & {
  duplicationTrap: boolean;
  blockingBillingIssue: boolean;
  replacesCodes: string[];
};

export type CrossSystemEvaluation = {
  configVersion: string;
  originalDiagnosisCodes: string[];
  matchedRules: Array<CrossSystemRule & { matchedKeywords: string[] }>;
  emergencyAlerts: Array<{ ruleId: string; trigger: string; text: string }>;
  combinationSuggestion: CombinationSuggestion | null;
  suggestedDiagnosisSequence: DiagnosisSuggestion[] | null;
  requiresScopeDisclaimer: boolean;
};

const COMBINATION_CODES = [
  { prefix: "F10", substance: ["alcohol"], feature: "delusion", code: "F10.150", description: "Alcohol abuse with alcohol-induced psychotic disorder with delusions" },
  { prefix: "F10", substance: ["alcohol"], feature: "hallucination", code: "F10.151", description: "Alcohol abuse with alcohol-induced psychotic disorder with hallucinations" },
  { prefix: "F12", substance: ["cannabis"], feature: "delusion", code: "F12.150", description: "Cannabis abuse with cannabis-induced psychotic disorder with delusions" },
  { prefix: "F14", substance: ["cocaine"], feature: "delusion", code: "F14.150", description: "Cocaine abuse with cocaine-induced psychotic disorder with delusions" },
  { prefix: "F15", substance: ["amphetamine", "amphetamines", "stimulant"], feature: "delusion", code: "F15.150", description: "Other stimulant abuse with stimulant-induced psychotic disorder with delusions" },
] as const;

function normalize(value: string) {
  return value.toLowerCase().replace(/[‐‑‒–—]/g, "-");
}

function phraseIsNegated(text: string, phrase: string) {
  const lower = normalize(text);
  const target = normalize(phrase);
  let index = lower.indexOf(target);
  while (index >= 0) {
    const context = lower.slice(Math.max(0, index - 35), index);
    if (!/\b(denies|denied|no|without|not|negative for)\b[^.!?;]*$/.test(context)) return false;
    index = lower.indexOf(target, index + target.length);
  }
  return true;
}

export function sanitizeImportedText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, 2000);
}

export function appendImportedText(existing: string, incoming: string) {
  const clean = sanitizeImportedText(incoming);
  if (!clean) return existing;
  const base = existing.trimEnd();
  return base ? `${base}\n\n${clean}` : clean;
}

function uniqueCodes(codes: string[]) {
  return Array.from(new Set(codes.map((code) => code.trim().toUpperCase()).filter(Boolean)));
}

function findCombination(narrative: string, codes: string[]): CombinationSuggestion | null {
  const lower = normalize(narrative);
  const hasPsychosisMarker = /\b(hallucination|hallucinations|delusion|delusions|paranoia|paranoid)\b/.test(lower)
    || codes.some((code) => /^F(?:2\d|3\d|4[0-8])/.test(code));
  if (!hasPsychosisMarker) return null;

  for (const item of COMBINATION_CODES) {
    const hasSubstance = codes.some((code) => code.startsWith(item.prefix)) || item.substance.some((word) => lower.includes(word));
    if (!hasSubstance || !lower.includes(item.feature)) continue;
    const separateSubstance = codes.find((code) => code.startsWith(item.prefix) && code !== item.code);
    const separatePsychosis = codes.find((code) => /^F(?:2\d|3\d|4[0-8])/.test(code) && code !== item.code);
    const replacesCodes = [separateSubstance, separatePsychosis].filter((value): value is string => Boolean(value));
    return {
      code: item.code,
      description: item.description,
      duplicationTrap: replacesCodes.length >= 2,
      blockingBillingIssue: true,
      replacesCodes,
    };
  }
  return null;
}

function f54Sequence(rule: CrossSystemRule, codes: string[]): DiagnosisSuggestion[] | null {
  const mhCode = codes.find((code) => code === rule.primaryMentalHealthCode || code.startsWith("F"));
  if (!mhCode) return null;
  const somaticCode = codes.find((code) => code === rule.somaticCode || code === rule.somaticAlternativeCode) ?? rule.somaticCode;
  const description = mhCode === rule.primaryMentalHealthCode ? rule.primaryMentalHealthDescription : "Active mental health diagnosis";
  return [
    { code: mhCode, description },
    { code: "F54", description: "Psychological and behavioral factors associated with disorders or diseases classified elsewhere" },
    { code: somaticCode, description: somaticCode === rule.somaticAlternativeCode ? rule.somaticAlternativeDescription : rule.somaticDescription },
  ];
}

export function evaluateCrossSystemEngine(input: { narrativeText: string; diagnosisCodes: string[] }): CrossSystemEvaluation {
  const narrative = normalize(input.narrativeText);
  const codes = uniqueCodes(input.diagnosisCodes);
  const matchedRules = CROSS_SYSTEM_RULES.flatMap((rule) => {
    const matchedKeywords = rule.keywords.filter((keyword) => narrative.includes(normalize(keyword)));
    const codeMatch = codes.some((code) => code === rule.somaticCode || code === rule.somaticAlternativeCode);
    const emergencyMatch = rule.emergencyTriggers.some((trigger) => narrative.includes(normalize(trigger)) && !phraseIsNegated(input.narrativeText, trigger));
    return matchedKeywords.length || codeMatch || emergencyMatch ? [{ ...rule, matchedKeywords }] : [];
  });
  const emergencyAlerts = matchedRules.flatMap((rule) => rule.emergencyTriggers.flatMap((trigger) =>
    narrative.includes(normalize(trigger)) && !phraseIsNegated(input.narrativeText, trigger)
      ? [{ ruleId: rule.id, trigger, text: rule.emergencyAlertText }]
      : []
  ));
  const combinationSuggestion = findCombination(input.narrativeText, codes);
  const suggestedDiagnosisSequence = combinationSuggestion
    ? [{ code: combinationSuggestion.code, description: combinationSuggestion.description }]
    : matchedRules.length ? f54Sequence(matchedRules[0], codes) : null;
  return {
    configVersion: CROSS_SYSTEM_CONFIG_VERSION,
    originalDiagnosisCodes: codes,
    matchedRules,
    emergencyAlerts,
    combinationSuggestion,
    suggestedDiagnosisSequence,
    requiresScopeDisclaimer: matchedRules.length > 0,
  };
}

export function appendScopeDisclaimer(noteText: string, required: boolean) {
  if (!required || noteText.includes(SCOPE_OF_PRACTICE_SAFETY_NOTE)) return noteText;
  return `${noteText.trimEnd()}\n\n${SCOPE_OF_PRACTICE_SAFETY_NOTE}`;
}
