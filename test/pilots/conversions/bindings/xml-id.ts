// Trusted TS binding for UnitsML's xml:id attribute type (Lutaml::Xml::W3c::XmlIdType).
// Ruby's class is a plain Type::String subclass: it casts to a String and enforces
// no NCName rule, so this binding is a string too and claims nothing more. The
// XML namespace of the attribute (xml:id) is NOT carried by a value binding.
export type XmlId = string;

export function isXmlId(value: unknown): value is XmlId {
  return typeof value === "string";
}

export function parseXmlId(lexical: string): XmlId {
  return lexical;
}

export function formatXmlId(value: XmlId): string {
  return value;
}
