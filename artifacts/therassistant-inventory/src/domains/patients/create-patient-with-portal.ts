export async function createPatientWithOptionalPortal<
  TPatient extends { id: string },
  TInvite,
>({
  enrollPortal,
  createPatient,
  invitePortal,
}: {
  enrollPortal: boolean;
  createPatient: () => Promise<TPatient>;
  invitePortal: (clientId: string) => Promise<TInvite>;
}) {
  const patient = await createPatient();

  if (!enrollPortal) {
    return {
      patient,
      portalInvitation: null as TInvite | null,
      portalError: null as string | null,
    };
  }

  try {
    const portalInvitation = await invitePortal(patient.id);
    return {
      patient,
      portalInvitation,
      portalError: null as string | null,
    };
  } catch (error) {
    return {
      patient,
      portalInvitation: null as TInvite | null,
      portalError:
        error instanceof Error
          ? error.message
          : "Unable to send patient portal invitation.",
    };
  }
}
