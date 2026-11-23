# frozen_string_literal: true

# Regenerates fixtures/conversions.json: the real UnitsML Conversions bundle
# exported by lutaml-model's LML exporter (explicit XmlIdType registration)
# plus Ruby oracles (portable JSON, Nokogiri XML) for real model instances.
# Conversions-only partial A6 evidence; Unit/Uncertainty are not covered.
#
#   ruby test/pilots/conversions/generate.rb \
#     --lutaml  <lutaml-model checkout at the pinned head> \
#     --unitsml <unitsml-ruby checkout> \
#     --oracle  <unitsml testsuite checkout> \
#     --out     test/pilots/conversions/fixtures/conversions.json
#
# Not run by TS CI: the fixture is committed. Every source root is explicit and
# its git head must equal the pin below, or the run stops.
require "json"
require "digest"
require "optparse"

PINS = {
  lutaml: "4fad925d9438ff92089d2086e5d3efebd452713b",
  unitsml: "ee09d6d7f87bb2f76069d1cb6ced6c64cbb2ebb1",
  oracle: "9db47641d84587df4241d9f5639a92f566f33cfa",
}.freeze

opts = {}
OptionParser.new do |o|
  PINS.each_key { |k| o.on("--#{k} PATH") { |v| opts[k] = File.expand_path(v) } }
  o.on("--out PATH") { |v| opts[:out] = File.expand_path(v) }
end.parse!
missing = (PINS.keys + [:out]).reject { |k| opts[k] }
abort("missing #{missing.map { |k| "--#{k}" }.join(', ')}") unless missing.empty?

heads = PINS.to_h do |key, pin|
  head = Dir.chdir(opts[key]) { `git rev-parse HEAD`.strip }
  abort("#{key} head #{head} is not the pin #{pin}") unless head == pin
  [key, head]
end

$LOAD_PATH.unshift("#{opts[:lutaml]}/lib", "#{opts[:unitsml]}/lib")
require "lutaml/model"
require "unitsml"
require "nokogiri"

# The XML oracle is the Nokogiri adapter, chosen explicitly.
Lutaml::Model::Config.configure { |c| c.xml_adapter_type = :nokogiri }
adapter = Lutaml::Model::Config.xml_adapter.name

lml = Lutaml::Model::Lml
units = Unitsml::Model::Units
w3c = Lutaml::Xml::W3c

# XmlIdType is registered explicitly: base string, no facets (the class
# enforces no NCName rule, so none is claimed).
registry = { "xml:id" => { class: w3c::XmlIdType, base: "string", facets: {} } }
bundle = lml.export_bundle(units::Conversions, value_types: registry)

corpus_path = "#{opts[:oracle]}/corpora/conversions/expected-conversions.json"
corpus = JSON.parse(File.read(corpus_path))
frozen = corpus["cases"].flat_map { |c| Array(c["definitions"]).map { |d| [c["id"], d["xml"]] } }
              .select { |_, xml| xml&.start_with?("<Float64ConversionFrom") }
              .uniq { |_, xml| xml }

dump = lambda do |instance|
  { "portable_json" => JSON.parse(lml.portable_json(instance)), "ruby_xml" => instance.to_xml }
end

cases = []
# 1. The frozen testsuite definitions, read by the real Ruby model and
#    re-serialized. The lexical values are exactly the frozen ones.
frozen.each do |case_id, xml|
  instance = units::Float64ConversionFrom.from_xml(xml)
  cases << { "id" => "frozen-#{case_id}", "model_id" => "Unitsml::Model::Units::Float64ConversionFrom@default",
             "source" => "testsuite corpora/conversions/expected-conversions.json case #{case_id}",
             "input_xml" => xml }.merge(dump.call(instance))
end

# 2. Constructed instances (synthetic sample values, real classes): long exact
#    lexical strings, integers, flags, repeated children.
long = "273.150000000000000000000000000000000000000000000000000000000001"
float64 = units::Float64ConversionFrom.new(
  id: "NISTc_long", initial_unit: "#NISTu5", initial_addend: "-#{long}",
  initial_addend_decimal_place: 62, multiplicand: "9", multiplicand_digits: 1,
  divisor: "5", divisor_digits: 1, final_addend: long, final_addend_decimal_place: 62,
  exact: false,
  conversion_note: [units::ConversionNote.new(content: "first"), units::ConversionNote.new(content: "second")],
)
cases << { "id" => "constructed-float64-long-lexical",
           "model_id" => "Unitsml::Model::Units::Float64ConversionFrom@default",
           "source" => "constructed; synthetic sample values" }.merge(dump.call(float64))

conversions = units::Conversions.new(
  float64_conversion_from: float64,
  special_conversion_from: units::SpecialConversionFrom.new(
    id: "NISTc_special", initial_unit: "#NISTu7", conversion_url: "https://example.org/special"
  ),
  wsdl_conversion_from: units::WsdlConversionFrom.new(id: "NISTc_wsdl", initial_unit: "#NISTu8",
                                                      wsdl_url: "https://example.org/w.wsdl"),
)
cases << { "id" => "constructed-conversions-container",
           "model_id" => "Unitsml::Model::Units::Conversions@default",
           "source" => "constructed; synthetic sample values" }.merge(dump.call(conversions))

# 3. Description children: Ruby's Nokogiri adapter writes them with xmlns="" (no
#    namespace) while the exported IR says "inherit" (the unitsml namespace).
#    Recorded as known gaps; the fixture keeps Ruby's output as the oracle.
gap = "Ruby writes ConversionDescription/WSDLDescription with xmlns=\"\" (unqualified); the exported IR rule says namespace inherit"
special = units::SpecialConversionFrom.new(id: "NISTc_special_d", initial_unit: "#NISTu7",
                                           conversion_url: "https://example.org/special", conversion_description: ["alpha", "beta"])
cases << { "id" => "constructed-special-description", "known_gap" => gap,
           "model_id" => "Unitsml::Model::Units::SpecialConversionFrom@default",
           "source" => "constructed; synthetic sample values" }.merge(dump.call(special))
wsdl = units::WsdlConversionFrom.new(id: "NISTc_wsdl_d", initial_unit: "#NISTu8", wsdl_url: "https://example.org/w.wsdl",
                                     wsdl_description: ["gamma"])
cases << { "id" => "constructed-wsdl-description", "known_gap" => gap,
           "model_id" => "Unitsml::Model::Units::WsdlConversionFrom@default",
           "source" => "constructed; synthetic sample values" }.merge(dump.call(wsdl))

fixture = {
  "provenance" => {
    "criterion" => "Conversions-only partial A6 evidence (not Unit/Uncertainty)",
    "heads" => heads.transform_keys(&:to_s),
    "ruby" => RUBY_VERSION, "xml_adapter" => adapter, "nokogiri" => Nokogiri::VERSION,
    "oracle_corpus_sha256" => Digest::SHA256.file(corpus_path).hexdigest,
    "bundle_checksum" => bundle.checksum,
    "value_type_registration" => registry.transform_values { |v| { "class" => v[:class].name, "base" => v[:base], "facets" => v[:facets] } },
    "generator" => "test/pilots/conversions/generate.rb",
  },
  "bundle" => JSON.parse(bundle.canonical_json),
  "cases" => cases,
}
File.write(opts[:out], "#{JSON.pretty_generate(fixture)}\n")
puts "wrote #{opts[:out]} (#{cases.size} cases, #{bundle.checksum})"
