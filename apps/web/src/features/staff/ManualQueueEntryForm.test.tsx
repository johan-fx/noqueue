import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ManualQueueEntryForm } from './ManualQueueEntryForm'
import { manualConsentVersion } from '@noqueue/contracts/queue'
afterEach(cleanup)
const restaurant = {
  type: 'restaurant' as const,
  receptionServices: [],
  spaces: [{ id: 'terrace', name: 'Terraza', maxPartySize: 4 }],
}
it('requires explicit consent and phone, starts at one diner and retains the request key on retry', async () => {
  const submit = vi
    .fn()
    .mockRejectedValueOnce(new Error('Retry'))
    .mockResolvedValue(undefined)
  render(
    <ManualQueueEntryForm
      locale="es"
      service={restaurant}
      whatsappRequired
      onSubmit={submit}
    />,
  )
  const button = screen.getByRole('button', { name: 'Añadir turno' })
  const consent = screen.getByRole('switch', {
    name: /Consentir notificaciones/,
  })
  expect(consent).not.toBeChecked()
  expect(button).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Nombre', { exact: true }), {
    target: { value: '  María  ' },
  })
  fireEvent.change(screen.getByLabelText('Nº de teléfono', { exact: true }), {
    target: { value: '612345678' },
  })
  expect(button).toBeDisabled()
  const partySize = screen.getByRole('spinbutton', {
    name: 'Número de comensales',
  })
  expect(partySize).toHaveValue(1)
  expect(partySize).toHaveAttribute('data-slot', 'input')
  fireEvent.click(screen.getByRole('button', { name: 'Terraza' }))
  fireEvent.click(consent)
  fireEvent.click(button)
  expect(await screen.findByRole('alert')).toHaveTextContent('Retry')
  fireEvent.click(button)
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
  expect(submit.mock.calls[0]![0]).toEqual({
    displayName: 'María',
    partySize: 1,
    locale: 'es',
    preferredSpaceId: 'terrace',
    whatsapp: {
      consent: true,
      phone: '+34612345678',
      version: manualConsentVersion,
    },
  })
  expect(submit.mock.calls[0]![1]).toBe(submit.mock.calls[1]![1])
})
it.each(['reception', 'pool'] as const)(
  'shows no party size for %s and allows explicit local offline admission',
  async (type) => {
    const submit = vi.fn().mockResolvedValue(undefined)
    render(
      <ManualQueueEntryForm
        locale="es"
        service={{
          ...restaurant,
          type,
          receptionServices: ['check_in', 'check_out', 'other'],
        }}
        whatsappRequired={false}
        onSubmit={submit}
      />,
    )
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Terraza' }),
    ).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Nombre', { exact: true }), {
      target: { value: 'Client' },
    })
    if (type === 'reception')
      fireEvent.click(screen.getByRole('button', { name: 'Check-out' }))
    fireEvent.click(screen.getByRole('button', { name: 'Añadir turno' }))
    await waitFor(() => expect(submit).toHaveBeenCalledOnce())
    expect(submit.mock.calls[0]![0]).toEqual({
      displayName: 'Client',
      partySize: 1,
      locale: 'es',
      whatsapp: { consent: false },
      ...(type === 'reception' ? { receptionService: 'check_out' } : {}),
    })
  },
)
it('guards duplicate submission while awaiting the response', async () => {
  const submit = vi.fn<
    (input: import('@noqueue/contracts/queue').ManualJoin) => Promise<void>
  >(() => new Promise<void>(() => {}))
  render(
    <ManualQueueEntryForm
      locale="es"
      service={restaurant}
      whatsappRequired={false}
      onSubmit={submit}
    />,
  )
  fireEvent.change(screen.getByLabelText('Nombre', { exact: true }), {
    target: { value: 'Client' },
  })
  const button = screen.getByRole('button', { name: 'Añadir turno' })
  fireEvent.click(button)
  fireEvent.submit(button.closest('form')!)
  expect(submit).toHaveBeenCalledOnce()
  expect(button).toBeDisabled()
})

it('selects France, accepts only a national number, and disables the selector while saving', async () => {
  const submit = vi.fn<
    (input: import('@noqueue/contracts/queue').ManualJoin) => Promise<void>
  >(() => new Promise<void>(() => {}))
  render(
    <ManualQueueEntryForm
      locale="es"
      service={restaurant}
      whatsappRequired
      onSubmit={submit}
    />,
  )
  const trigger = screen.getByRole('combobox', { name: 'País' })
  fireEvent.click(trigger)
  fireEvent.change(screen.getByRole('combobox', { name: 'Buscar país' }), {
    target: { value: 'Francia' },
  })
  fireEvent.click(await screen.findByRole('option', { name: /Francia/ }))
  fireEvent.change(screen.getByLabelText('Nombre', { exact: true }), {
    target: { value: 'Guest' },
  })
  fireEvent.change(screen.getByLabelText('Nº de teléfono', { exact: true }), {
    target: { value: '612345678' },
  })
  fireEvent.click(screen.getByRole('switch'))
  fireEvent.click(screen.getByRole('button', { name: 'Añadir turno' }))
  expect(submit.mock.calls[0]![0].whatsapp).toMatchObject({
    consent: true,
    phone: '+33612345678',
  })
  expect(trigger).toBeDisabled()
})

it.each(['restaurant', 'reception', 'pool'] as const)(
  'places the phone after service fields for %s',
  (type) => {
    render(
      <ManualQueueEntryForm
        locale="es"
        service={{ ...restaurant, type, receptionServices: ['check_in'] }}
        whatsappRequired
        onSubmit={vi.fn()}
      />,
    )
    const name = screen.getByLabelText('Nombre', { exact: true })
    const phone = screen.getByLabelText('Nº de teléfono', { exact: true })
    expect(
      name.compareDocumentPosition(phone) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    const serviceField =
      type === 'restaurant'
        ? screen.getByRole('group', { name: 'Espacio' })
        : type === 'reception'
        ? screen.getByRole('group', { name: 'Tipo de gestión' })
        : name
    expect(
      serviceField.compareDocumentPosition(phone) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      phone.compareDocumentPosition(screen.getByRole('switch')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  },
)

it('preserves input values and consent on locale changes and submits the selected language', async () => {
  const submit = vi.fn().mockResolvedValue(undefined)
  const props = {
    service: restaurant,
    whatsappRequired: true,
    onSubmit: submit,
  }
  const { rerender } = render(<ManualQueueEntryForm {...props} locale="es" />)
  fireEvent.change(screen.getByLabelText('Nombre', { exact: true }), {
    target: { value: 'María' },
  })
  fireEvent.change(screen.getByLabelText('Nº de teléfono', { exact: true }), {
    target: { value: '600000000' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Más comensales' }))
  fireEvent.click(screen.getByRole('button', { name: 'Terraza' }))
  fireEvent.click(screen.getByRole('switch'))
  rerender(<ManualQueueEntryForm {...props} locale="en" />)
  expect(screen.getByLabelText('Name', { exact: true })).toHaveValue('María')
  expect(
    (screen.getByLabelText('Phone number', { exact: true }) as HTMLInputElement)
      .value.replace(/\D/g, ''),
  ).toBe('600000000')
  expect(
    screen.getByRole('spinbutton', { name: 'Number of diners' }),
  ).toHaveValue(2)
  expect(screen.getByRole('button', { name: 'Terraza' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(screen.getByRole('switch')).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Add queue entry' }))
  await waitFor(() => expect(submit).toHaveBeenCalledOnce())
  expect(submit.mock.calls[0]![0]).toMatchObject({
    locale: 'en',
    partySize: 2,
    whatsapp: { version: manualConsentVersion },
  })
})

it.each(['es', 'en'] as const)(
  'renders full legal notice in %s and blocks invalid phone submission',
  (locale) => {
    const submit = vi.fn()
    render(
      <ManualQueueEntryForm
        locale={locale}
        service={restaurant}
        whatsappRequired
        onSubmit={submit}
      />,
    )
    expect(
      screen.getByText(
        /LUMOSA S.A. con CIF|LUMOSA S.A., with tax identification/,
      ),
    ).toHaveTextContent('A07207848')
    expect(
      screen.getByText(
        /LUMOSA S.A. con CIF|LUMOSA S.A., with tax identification/,
      ),
    ).toHaveTextContent('Avda Cas Saboners Nº8, 07181, Calviá - Illes Balears')
    expect(
      screen.getByText(
        locale === 'es'
          ? /Mientras se mantenga el consentimiento prestado/
          : /For as long as your consent remains in effect/,
      ),
    ).toBeVisible()
    expect(
      screen.getByText(
        locale === 'es' ? /al activar esta opción/ : /by enabling this option/,
      ),
    ).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'hola@noqueue-app.com' }),
    ).toHaveAttribute('href', 'mailto:hola@noqueue-app.com')
    expect(screen.queryByText(/MAIL EMPRESA|whastapp/)).not.toBeInTheDocument()
    fireEvent.change(
      screen.getByLabelText(locale === 'es' ? 'Nombre' : 'Name', {
        exact: true,
      }),
      { target: { value: 'Client' } },
    )
    fireEvent.change(
      screen.getByLabelText(
        locale === 'es' ? 'Nº de teléfono' : 'Phone number',
        { exact: true },
      ),
      { target: { value: '123' } },
    )
    const phone = screen.getByLabelText(
      locale === 'es' ? 'Nº de teléfono' : 'Phone number',
      { exact: true },
    )
    fireEvent.blur(phone)
    expect(screen.getByRole('alert')).toHaveTextContent(
      locale === 'es'
        ? 'Introduce un número de teléfono válido.'
        : 'Enter a valid phone number.',
    )
    fireEvent.click(screen.getByRole('switch'))
    const button = screen.getByRole('button', {
      name: locale === 'es' ? 'Añadir turno' : 'Add queue entry',
    })
    expect(button).toBeDisabled()
    fireEvent.submit(button.closest('form')!)
    expect(submit).not.toHaveBeenCalled()
  },
)

it('translates server validation errors without changing form state', async () => {
  const { ApiError } = await import('./api')
  const submit = vi
    .fn()
    .mockRejectedValue(
      new ApiError(
        503,
        'Los avisos de WhatsApp no están disponibles. Contacta con la administración.',
        0,
        'whatsapp_unavailable',
      ),
    )
  const props = {
    service: restaurant,
    whatsappRequired: false,
    onSubmit: submit,
  }
  const { rerender } = render(<ManualQueueEntryForm {...props} locale="en" />)
  fireEvent.change(screen.getByLabelText('Name', { exact: true }), {
    target: { value: 'Guest' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add queue entry' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'WhatsApp notifications are unavailable. Contact the administrator.',
  )
  rerender(<ManualQueueEntryForm {...props} locale="es" />)
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Los avisos de WhatsApp no están disponibles.',
  )
  expect(screen.getByLabelText('Nombre', { exact: true })).toHaveValue('Guest')
})

const legalNotice = {
  es: [
    'De conformidad con la normativa vigente y aplicable en protección de datos de carácter personal, le informamos que sus datos serán incorporados al sistema de tratamiento titularidad de LUMOSA S.A. con CIF A07207848 y domicilio social sito en Avda Cas Saboners Nº8, 07181, Calviá - Illes Balears y que a continuación se relacionan sus respectivas finalidades, plazos de conservación y bases legitimadoras.',
    'Finalidad: Captación, registro y tratamiento de los datos con la finalidad de remitir comunicaciones y documentación a través de la plataforma de WhatsApp con comunicación directa y bidireccional.',
    'Plazo de conservación: Mientras se mantenga el consentimiento prestado.',
    'Base legítima: El consentimiento del interesado.',
    'De acuerdo con los derechos que le confiere la normativa vigente y aplicable en protección de datos podrá ejercer los derechos de acceso, rectificación, limitación de tratamiento, supresión (“derecho al olvido”), portabilidad y oposición al tratamiento de sus datos de carácter personal así como la revocación del consentimiento prestado para el tratamiento de los mismos, dirigiendo su petición a la dirección postal indicada más arriba o al correo electrónico hola@noqueue-app.com.',
    'Podrá dirigirse a la Autoridad de Control competente para presentar la reclamación que considere oportuna. LUMOSA S.A. informa que, al activar esta opción, otorga su consentimiento explícito para el tratamiento de sus datos con las finalidades mencionadas anteriormente.',
  ],
  en: [
    'In accordance with current applicable personal data protection legislation, we inform you that your data will be incorporated into the data processing system owned by LUMOSA S.A., with tax identification number A07207848 and registered office at Avda Cas Saboners Nº8, 07181, Calviá - Illes Balears. The corresponding purposes, retention periods and legal bases are set out below.',
    'Purpose: Collection, recording and processing of data to send communications and documentation through the WhatsApp platform, enabling direct, two-way communication.',
    'Retention period: For as long as your consent remains in effect.',
    'Legal basis: The data subject’s consent.',
    'Under current applicable data protection legislation, you may exercise your rights of access, rectification, restriction of processing, erasure (“right to be forgotten”), data portability and objection to the processing of your personal data, as well as withdraw your consent to such processing, by sending your request to the postal address stated above or to hola@noqueue-app.com.',
    'You may contact the competent supervisory authority to lodge any complaint you consider appropriate. LUMOSA S.A. informs you that, by enabling this option, you give your explicit consent to the processing of your data for the purposes stated above.',
  ],
}
it.each(['es', 'en'] as const)(
  'renders every approved legal paragraph and purpose unchanged in %s',
  (locale) => {
    const { container } = render(
      <ManualQueueEntryForm
        locale={locale}
        service={restaurant}
        whatsappRequired
        onSubmit={vi.fn()}
      />,
    )
    const email = screen.getByRole('link', { name: 'hola@noqueue-app.com' })
    const notice = email.parentElement!.parentElement!
    expect(
      Array.from(notice.querySelectorAll('p,li'), (element) =>
        element.textContent?.replace(/\s+/g, ' ').trim(),
      ),
    ).toEqual(legalNotice[locale])
    expect(container.querySelector('form')).toHaveAttribute('lang', locale)
  },
)
