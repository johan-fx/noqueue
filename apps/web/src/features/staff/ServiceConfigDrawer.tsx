import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useForm, useWatch, type FieldPath } from 'react-hook-form'
import { ChevronLeft } from 'lucide-react'
import { serviceSchema, type ServiceInput } from '@noqueue/contracts/staff'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTrigger,
} from '@/components/reui/stepper'
import { AddSpaceDrawer } from './service-config/AddSpaceStep'
import { CapacityStep } from './service-config/CapacityStep'
import { GeneralStep } from './service-config/GeneralStep'
import { PreferenceStep } from './service-config/PreferenceStep'
import { QueueStep } from './service-config/QueueStep'
import { SummaryStep } from './service-config/SummaryStep'
import { emptyService, serviceTitles, stepLabels, stepsFor } from './service-config/model'
import { issuesFor } from './service-config/validate'

export function ServiceConfigDrawer({
  open,
  mode,
  initial,
  saving = false,
  error = '',
  resetKey = 'create',
  finalFocus,
  onClose,
  onSave,
}: {
  open: boolean
  mode: 'create' | 'edit'
  initial?: ServiceInput
  saving?: boolean
  error?: string
  // Identifies which service is being edited. The drawer itself stays mounted
  // so Base UI can play the enter transition; only the form values reset.
  resetKey?: string
  finalFocus?: RefObject<HTMLElement | null>
  onClose: () => void
  onSave: (input: ServiceInput) => void | Promise<void>
}) {
  const form = useForm<ServiceInput>({
    defaultValues: { ...emptyService, ...initial },
  })
  const type = useWatch({ control: form.control, name: 'type' })
  const steps = stepsFor(type)
  const [index, setIndex] = useState(0)
  const [addingSpace, setAddingSpace] = useState(false)
  const openedKey = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!open) {
      openedKey.current = null
      return
    }
    if (openedKey.current === resetKey) return
    openedKey.current = resetKey
    form.reset({ ...emptyService, ...initial })
    setIndex(0)
    setAddingSpace(false)
  }, [open, resetKey, initial, form])
  const step = steps[index] ?? 'general'
  function back() {
    if (index === 0) onClose()
    else setIndex((current) => current - 1)
  }

  function showIssues() {
    form.clearErrors()
    const issues = issuesFor(form.getValues(), step)
    for (const issue of issues)
      form.setError(issue.path as FieldPath<ServiceInput>, {
        message: issue.message,
      })
    return issues.length === 0
  }

  async function forward() {
    if (step !== 'summary') {
      if (!showIssues()) return
      setIndex((current) => current + 1)
      return
    }
    const parsed = serviceSchema.safeParse(form.getValues())
    if (!parsed.success) {
      form.setError('root', { message: 'Revisa los datos antes de confirmar.' })
      return
    }
    await onSave({
      ...parsed.data,
      assignmentPreference: parsed.data.assignmentPreference ?? 'fastest',
    })
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose()
      }}
      swipeDirection="right"
    >
      <DrawerContent
        finalFocus={finalFocus}
        className="w-full sm:w-md"
      >
        <DrawerHeader className="gap-4 border-b p-6">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Volver"
              disabled={saving}
              onClick={back}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <div>
              <DrawerTitle className="text-xl">{serviceTitles[type]}</DrawerTitle>
            </div>
          </div>
          <div className="space-y-2">
              <Stepper value={index + 1} onValueChange={() => undefined}>
                <StepperNav>
                  {steps.map((item, itemIndex) => (
                    <StepperItem key={item} step={itemIndex + 1}>
                      <StepperTrigger
                        className="pointer-events-none"
                        tabIndex={-1}
                        aria-hidden="true"
                      >
                        <StepperIndicator className="size-2.5 border-0 bg-muted data-[state=active]:bg-foreground data-[state=completed]:bg-foreground" />
                      </StepperTrigger>
                      {itemIndex < steps.length - 1 && (
                        // The stock separator stays bg-muted. Completed steps
                        // only turn the line dark when this state class is set.
                        <StepperSeparator className="data-[state=completed]:bg-foreground" />
                      )}
                    </StepperItem>
                  ))}
                </StepperNav>
              </Stepper>
              <DrawerDescription>
                {index + 1}. {stepLabels[step]}
              </DrawerDescription>
            </div>
        </DrawerHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-6">
          {(error || form.formState.errors.root) && (
            <p role="alert" className="text-destructive">
              {error || form.formState.errors.root?.message}
            </p>
          )}
          {step === 'general' ? (
            <GeneralStep form={form} lockType={mode === 'edit'} />
          ) : step === 'capacity' && type !== 'reception' ? (
            <AddSpaceDrawer
              open={addingSpace}
              type={type}
              onOpenChange={setAddingSpace}
              onAdd={(name) => {
                form.setValue('spaces', [
                  ...form.getValues('spaces'),
                  { name, tables: 1 },
                ])
                setAddingSpace(false)
              }}
            >
              <CapacityStep form={form} />
            </AddSpaceDrawer>
          ) : step === 'capacity' ? (
            <CapacityStep form={form} />
          ) : step === 'queue' ? (
            <QueueStep form={form} />
          ) : step === 'preference' ? (
            <PreferenceStep form={form} />
          ) : (
            <SummaryStep values={form.getValues()} />
          )}
        </div>
        <DrawerFooter className="border-t bg-background p-4">
          <Button
            type="button"
            className="h-12 w-full"
            disabled={saving}
            onClick={() => void forward()}
          >
            {saving ? 'Guardando…' : step === 'summary' ? 'Confirmar' : 'Siguiente'}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
