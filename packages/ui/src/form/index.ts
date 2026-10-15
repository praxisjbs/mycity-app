/**
 * The Forms group (FRONTEND_GUIDE §8). The only folder where a raw <form>, <input>, <select>,
 * <textarea> or <label> may be written, and the only importer of react-hook-form (gate 12).
 * Each component file in this folder is exported here (npm run new:component adds the line).
 */
export type { FieldBinding, FieldState, ServerFields } from "./binding";
export { useContractForm, rules, shortMessage, PAUSE_MS, type ContractFormOptions, type ContractSchema, type FormRules, type Validator } from "./useContractForm";
export { Field, FormRow, FormError, type FieldProps, type FormRowProps, type FormErrorProps } from "./Field";
export {
  TextField,
  PasswordField,
  NumberField,
  PhoneField,
  TextAreaField,
  type TextFieldProps,
  type PasswordFieldProps,
  type NumberFieldProps,
  type PhoneFieldProps,
  type TextAreaFieldProps,
} from "./TextField";
export { SelectField, ChoiceField, type SelectFieldProps, type ChoiceFieldProps, type Option } from "./SelectField";
export { Switch, ToggleRow, CheckboxField, type SwitchProps, type ToggleRowProps, type CheckboxFieldProps } from "./Switch";
export { DateField, DateRangeField, TimeField, type DateFieldProps, type DateRangeFieldProps, type TimeFieldProps, type DateRange } from "./DateField";
export { MoneyField, toMoneyString, type MoneyFieldProps } from "./MoneyField";
export { SearchInput, FilterSelect, type SearchInputProps, type FilterSelectProps } from "./SearchInput";
export { InlineInput, InlineSelect, InlineLabel, type InlineInputProps, type InlineSelectProps, type InlineLabelProps } from "./InlineInput";
export { LoginField, type LoginFieldProps } from "./LoginField";
export { OtpField, type OtpFieldProps } from "./OtpField";
export { Form, FormFooter, type FormProps, type FormFooterProps } from "./Form";
export { Wizard, type WizardProps, type WizardStep } from "./Wizard";
