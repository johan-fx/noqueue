import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from 'cn'
import { ChevronDown, Globe } from 'lucide-react'
import BasePhoneInput, {
  getCountryCallingCode,
  type Country,
  type FlagProps,
  type Props as BasePhoneInputProps,
} from 'react-phone-number-input'
import flags from 'react-phone-number-input/flags'
import enLabels from 'react-phone-number-input/locale/en.json'
import esLabels from 'react-phone-number-input/locale/es.json'
import { useMemo, useState } from 'react'

type PhoneInputLocale = 'es' | 'en'
type CountryEntry = { label: string; value: Country | undefined }

const localeLabels = { en: enLabels, es: esLabels }
const localeCopy = {
  es: {
    country: 'País',
    search: 'Buscar país',
    placeholder: 'Buscar país',
    empty: 'No se encontró ningún país.',
  },
  en: {
    country: 'Country',
    search: 'Search country',
    placeholder: 'Search country',
    empty: 'No country found.',
  },
} satisfies Record<PhoneInputLocale, Record<string, string>>

type PhoneInputProps = Omit<
  BasePhoneInputProps<React.ComponentProps<'input'>>,
  | 'value'
  | 'onChange'
  | 'ref'
  | 'className'
  | 'labels'
  | 'countrySelectProps'
  | 'countrySelectComponent'
  | 'inputComponent'
  | 'addInternationalOption'
  | 'smartCaret'
> & {
  locale: PhoneInputLocale
  className?: string
  value: string
  onChange: (value: string) => void
  defaultCountry?: Country
}

export function PhoneInput({
  className,
  locale,
  defaultCountry = 'ES',
  value,
  onChange,
  autoComplete = 'tel-national',
  inputMode = 'tel',
  ...props
}: PhoneInputProps) {
  return (
    <BasePhoneInput
      {...props}
      type="tel"
      autoComplete={autoComplete}
      inputMode={inputMode}
      defaultCountry={defaultCountry}
      labels={localeLabels[locale]}
      className={cn('flex min-w-0', className)}
      countrySelectProps={{ locale }}
      countrySelectComponent={CountrySelect}
      inputComponent={PhoneNumberInput}
      addInternationalOption={false}
      smartCaret={false}
      value={value}
      onChange={(nextValue) => onChange(nextValue || '')}
    />
  )
}

function PhoneNumberInput({
  className,
  ...props
}: React.ComponentProps<'input'>) {
  return (
    <Input
      {...props}
      className={cn('h-11 min-w-0 flex-1 rounded-s-none', className)}
    />
  )
}

type CountrySelectProps = {
  disabled?: boolean
  value: Country
  options: CountryEntry[]
  onChange: (country: Country) => void
  locale?: PhoneInputLocale
}

function CountrySelect({
  disabled,
  value: selectedCountry,
  options,
  onChange,
  locale = 'en',
}: CountrySelectProps) {
  const copy = localeCopy[locale]
  const [searchValue, setSearchValue] = useState('')
  const countryList = useMemo(
    () =>
      options.filter(
        (option): option is { label: string; value: Country } =>
          !!option.value,
      ),
    [options],
  )
  const filteredCountries = useMemo(() => {
    const search = searchValue.trim().toLocaleLowerCase(locale)
    if (!search) return countryList
    return countryList.filter(({ label, value }) => {
      const callingCode = `+${getCountryCallingCode(value)}`
      return (
        label.toLocaleLowerCase(locale).includes(search) ||
        callingCode.includes(search)
      )
    })
  }, [countryList, locale, searchValue])
  const selectedLabel =
    countryList.find(({ value }) => value === selectedCountry)?.label ??
    selectedCountry
  const callingCode = `+${getCountryCallingCode(selectedCountry)}`

  return (
    <ComboboxPrimitive.Root
      items={filteredCountries}
      value={selectedCountry}
      disabled={disabled}
      onOpenChange={(open) => {
        if (!open) setSearchValue('')
      }}
      onValueChange={(country: Country | null) => {
        if (country) {
          setSearchValue('')
          onChange(country)
        }
      }}
    >
      <ComboboxPrimitive.Trigger
        render={
          <Button
            type="button"
            variant="outline"
            aria-label={copy.country}
            aria-valuetext={`${selectedLabel}, ${callingCode}`}
            disabled={disabled}
            className="h-11 shrink-0 gap-2 rounded-e-none px-3"
          >
            <FlagComponent
              country={selectedCountry}
              countryName={selectedLabel}
            />
            <span aria-hidden="true" className="text-sm font-normal">
              {callingCode}
            </span>
            <ChevronDown aria-hidden="true" className="size-4 opacity-60" />
          </Button>
        }
      />
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          sideOffset={4}
          align="start"
          className="z-50"
        >
          <ComboboxPrimitive.Popup
            data-slot="phone-country-popup"
            className="w-72 max-w-[calc(100vw-2rem)] max-h-(--available-height) overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
          >
            <ComboboxPrimitive.Input
              aria-label={copy.search}
              autoComplete="off"
              placeholder={copy.placeholder}
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              render={<Input className="h-11 border-0 shadow-none" />}
            />
            <ComboboxPrimitive.Empty
              role="presentation"
              aria-live="off"
              className="p-3 text-sm text-muted-foreground"
            >
              {copy.empty}
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List>
              {filteredCountries.map((country) => (
                <ComboboxPrimitive.Item
                  key={country.value}
                  value={country.value}
                  className="flex cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <FlagComponent
                    country={country.value}
                    countryName={country.label}
                  />
                  <span className="flex-1">{country.label}</span>
                  <span className="text-foreground/50">
                    +{getCountryCallingCode(country.value)}
                  </span>
                </ComboboxPrimitive.Item>
              ))}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  )
}

function FlagComponent({ country, countryName }: FlagProps) {
  const Flag = flags[country]
  return (
    <span className="flex size-4 shrink-0 items-center justify-center [&_svg:not([class*='size-'])]:size-full! [&_svg:not([class*='size-'])]:rounded-[5px]">
      {Flag ? (
        <Flag title={countryName} />
      ) : (
        <Globe aria-label={countryName} className="size-4 opacity-60" />
      )}
    </span>
  )
}
