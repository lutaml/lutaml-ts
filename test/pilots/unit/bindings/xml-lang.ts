// Trusted TS binding for UnitsML's xml:lang attribute type (Lutaml::Xml::W3c::XmlLangType).
// Ruby's class is a plain Type::String subclass: it casts to a String and enforces
// no NCName rule, so this binding is a string too and claims nothing more. The
// XML namespace of the attribute (xml:lang) is NOT carried by a value binding.
export type XmlLang = string;

export function isXmlLang(value: unknown): value is XmlLang {
  return typeof value === "string";
}

export function parseXmlLang(lexical: string): XmlLang {
  return lexical;
}

export function formatXmlLang(value: XmlLang): string {
  return value;
}
