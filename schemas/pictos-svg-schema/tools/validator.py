#!/usr/bin/env python3
"""
MediaFranca SVG Schema Validator

Validates SVG pictograms against the MediaFranca SVG Schema specification.
Checks for:
- Well-formed XML
- Valid metadata block (against metadata.schema.json)
- Required ARIA attributes
- Semantic group structure
- Concept-to-group correspondence

Usage:
    python validator.py <svg-file>
    python validator.py --help
"""

import argparse
import json
import sys
import subprocess
from pathlib import Path
from typing import Dict, List, Tuple
import xml.etree.ElementTree as ET

try:
    import jsonschema
    JSONSCHEMA_AVAILABLE = True
except ImportError:
    JSONSCHEMA_AVAILABLE = False


# Namespace definitions
NS = {
    'svg': 'http://www.w3.org/2000/svg',
    'xlink': 'http://www.w3.org/1999/xlink'
}


class ValidationError(Exception):
    """Custom exception for validation errors."""
    pass


class SVGValidator:
    """Validator for MediaFranca SVG pictograms."""

    def __init__(self, svg_path: Path, schema_path: Path = None):
        self.svg_path = svg_path
        self.schema_path = schema_path or (
            Path(__file__).parent.parent / 'schemas' / 'metadata.schema.json'
        )
        self.tree = None
        self.root = None
        self.metadata = None
        self.errors: List[str] = []
        self.warnings: List[str] = []

    def validate(self) -> Tuple[bool, List[str], List[str]]:
        """
        Validate the SVG file against the MediaFranca schema.

        Returns:
            Tuple of (is_valid, errors, warnings)
        """
        self.errors = []
        self.warnings = []

        try:
            self._parse_svg()
            self._check_root_attributes()
            self._check_title_and_desc()
            self._extract_and_validate_metadata()
            self._check_embedded_stylesheet()
            self._check_semantic_groups()
            self._check_concept_group_correspondence()
        except ValidationError as e:
            self.errors.append(str(e))
        except Exception as e:
            self.errors.append(f"Unexpected error: {e}")

        is_valid = len(self.errors) == 0
        return is_valid, self.errors, self.warnings

    def _parse_svg(self):
        """Parse the SVG file."""
        try:
            self.tree = ET.parse(self.svg_path)
            self.root = self.tree.getroot()
        except ET.ParseError as e:
            raise ValidationError(f"XML parsing error: {e}")
        except FileNotFoundError:
            raise ValidationError(f"File not found: {self.svg_path}")

        # Check root element
        if self.root.tag != f"{{{NS['svg']}}}svg" and self.root.tag != 'svg':
            raise ValidationError(f"Root element must be <svg>, found: {self.root.tag}")

    def _check_root_attributes(self):
        """Check required attributes on the root <svg> element."""
        required_attrs = {
            'role': 'img',
            'aria-labelledby': None,  # Must exist but value varies
        }

        for attr, expected_value in required_attrs.items():
            actual_value = self.root.get(attr)
            if actual_value is None:
                self.errors.append(f"Missing required attribute on <svg>: {attr}")
            elif expected_value and actual_value != expected_value:
                self.errors.append(
                    f"Incorrect value for <svg> attribute '{attr}': "
                    f"expected '{expected_value}', found '{actual_value}'"
                )

        # Check namespaces
        if 'xmlns' not in self.root.attrib:
            # ElementTree may handle this differently; check the root tag
            if NS['svg'] not in self.root.tag:
                self.warnings.append("SVG namespace not explicitly declared")

    def _check_title_and_desc(self):
        """Check for required <title> and <desc> elements."""
        title = self.root.find('svg:title', NS)
        if title is None:
            title = self.root.find('title')

        desc = self.root.find('svg:desc', NS)
        if desc is None:
            desc = self.root.find('desc')

        if title is None:
            self.errors.append("Missing required <title> element")
        else:
            if not title.text or not title.text.strip():
                self.errors.append("<title> element is empty")
            if not title.get('id'):
                self.warnings.append("<title> should have an 'id' attribute")

        if desc is None:
            self.errors.append("Missing required <desc> element")
        else:
            if not desc.text or not desc.text.strip():
                self.errors.append("<desc> element is empty")
            if not desc.get('id'):
                self.warnings.append("<desc> should have an 'id' attribute")

    def _extract_and_validate_metadata(self):
        """Extract and validate the metadata block."""
        # Find metadata element
        metadata_elem = self.root.find('svg:metadata', NS)
        if metadata_elem is None:
            metadata_elem = self.root.find('metadata')

        if metadata_elem is None:
            raise ValidationError("Missing required <metadata> element")

        # Check for ID
        metadata_id = metadata_elem.get('id')
        if metadata_id != 'mf-accessibility':
            self.warnings.append(
                f"<metadata> id should be 'mf-accessibility', found: {metadata_id}"
            )

        # Extract JSON content
        metadata_text = metadata_elem.text
        if not metadata_text or not metadata_text.strip():
            raise ValidationError("<metadata> element is empty")

        # Parse JSON
        try:
            self.metadata = json.loads(metadata_text)
        except json.JSONDecodeError as e:
            raise ValidationError(f"Invalid JSON in <metadata>: {e}")

        # Validate against schema
        if JSONSCHEMA_AVAILABLE:
            self._validate_metadata_schema()
        else:
            raise ValidationError("jsonschema is required; refusing incomplete legacy validation")

    def _validate_metadata_schema(self):
        """Validate metadata against the JSON schema."""
        if not self.schema_path.exists():
            raise ValidationError(f"Schema file not found: {self.schema_path}")

        try:
            with open(self.schema_path, 'r', encoding='utf-8') as f:
                schema = json.load(f)
        except Exception as e:
            raise ValidationError(f"Could not load schema: {e}")

        try:
            jsonschema.validate(instance=self.metadata, schema=schema)
        except jsonschema.ValidationError as e:
            self.errors.append(f"Metadata schema validation error: {e.message}")
        except Exception as e:
            self.errors.append(f"Metadata validation error: {e}")

    def _validate_metadata_basic(self):
        """Basic validation of metadata structure without full schema validation."""
        required_fields = ['version', 'utterance', 'nsm', 'concepts', 'provenance']

        for field in required_fields:
            if field not in self.metadata:
                self.errors.append(f"Missing required metadata field: {field}")

        # Check concepts structure
        if 'concepts' in self.metadata:
            if not isinstance(self.metadata['concepts'], list):
                self.errors.append("metadata.concepts must be an array")
            elif len(self.metadata['concepts']) == 0:
                self.errors.append("metadata.concepts array is empty")
            else:
                for i, concept in enumerate(self.metadata['concepts']):
                    if not isinstance(concept, dict):
                        self.errors.append(f"metadata.concepts[{i}] must be an object")
                        continue

                    # role and label are always required
                    for req_field in ['role', 'label']:
                        if req_field not in concept:
                            self.errors.append(
                                f"Missing required field '{req_field}' in metadata.concepts[{i}]"
                            )

                    # id is required only for non-implicit concepts
                    is_implicit = concept.get('implicit', False)
                    if not is_implicit and 'id' not in concept:
                        role = concept.get('role', 'unknown')
                        self.errors.append(
                            f"Missing required field 'id' in metadata.concepts[{i}] (role: {role}). "
                            "Explicit concepts must have an 'id' field."
                        )

    def _check_embedded_stylesheet(self):
        """Check for embedded stylesheet in <defs>."""
        defs = self.root.find('svg:defs', NS)
        if defs is None:
            defs = self.root.find('defs')

        if defs is None:
            self.warnings.append("No <defs> element found; embedded stylesheet recommended")
            return

        style = defs.find('svg:style', NS)
        if style is None:
            style = defs.find('style')

        if style is None:
            self.warnings.append("No <style> element in <defs>; embedded stylesheet recommended")
            return

        style_text = style.text or ""

        # Check for required classes
        required_classes = ['.f', '.k']
        for cls in required_classes:
            if cls not in style_text:
                self.warnings.append(f"Embedded stylesheet should define class '{cls}'")

        # Check for accessibility media queries
        if '@media (prefers-contrast: high)' not in style_text:
            self.warnings.append("Embedded stylesheet should include '@media (prefers-contrast: high)'")

        if '@media (forced-colors: active)' not in style_text:
            self.warnings.append("Embedded stylesheet should include '@media (forced-colors: active)'")

    def _check_semantic_groups(self):
        """Check that semantic groups have required attributes."""
        # Find all <g> elements
        groups = self.root.findall('.//svg:g', NS)
        if not groups:
            groups = self.root.findall('.//g')

        if not groups:
            self.warnings.append("No <g> elements found; semantic grouping recommended")
            return

        for i, group in enumerate(groups):
            group_id = group.get('id', f'(unnamed group {i})')

            # Check for data-concept attribute
            data_concept = group.get('data-concept')
            if data_concept is None:
                # This might be a nested group or decorative; check if it's a top-level semantic group
                if group.get('role') == 'group':
                    self.warnings.append(f"Group '{group_id}' has role='group' but no data-concept attribute")

            # If it has data-concept, check other required attributes
            if data_concept:
                required_attrs = {
                    'role': 'group',
                    'tabindex': '0',
                    'aria-label': None,
                }

                for attr, expected_value in required_attrs.items():
                    actual_value = group.get(attr)
                    if actual_value is None:
                        self.errors.append(
                            f"Semantic group '{group_id}' missing required attribute: {attr}"
                        )
                    elif expected_value and actual_value != expected_value:
                        self.errors.append(
                            f"Semantic group '{group_id}' attribute '{attr}': "
                            f"expected '{expected_value}', found '{actual_value}'"
                        )

    def _check_concept_group_correspondence(self):
        """Verify that all metadata concepts have corresponding SVG groups."""
        if not self.metadata or 'concepts' not in self.metadata:
            return

        # Collect all group IDs
        groups = self.root.findall('.//svg:g', NS)
        if not groups:
            groups = self.root.findall('.//g')
        group_ids = {g.get('id') for g in groups if g.get('id')}

        # Check each concept
        for concept in self.metadata['concepts']:
            concept_id = concept.get('id')
            is_implicit = concept.get('implicit', False)

            # If concept is implicit, it doesn't need a corresponding SVG group
            if is_implicit:
                if concept_id:
                    self.warnings.append(
                        f"Concept '{concept_id}' is marked as implicit but has an 'id' field. "
                        "Implicit concepts typically don't have corresponding SVG groups."
                    )
                continue

            # For explicit concepts, id is required
            if not concept_id:
                role = concept.get('role', 'unknown')
                self.errors.append(
                    f"Concept with role '{role}' is not marked as implicit but has no 'id' field"
                )
                continue

            # Check that the id corresponds to an actual SVG group
            if concept_id not in group_ids:
                self.errors.append(
                    f"Metadata concept '{concept_id}' has no corresponding <g> element in the SVG"
                )


def print_results(svg_path: Path, is_valid: bool, errors: List[str], warnings: List[str]):
    """Print validation results in a readable format."""
    print(f"\n{'='*70}")
    print(f"MediaFranca SVG Schema Validation Results")
    print(f"{'='*70}")
    print(f"File: {svg_path}")
    print(f"Status: {'✓ VALID' if is_valid else '✗ INVALID'}")
    print(f"{'='*70}\n")

    if errors:
        print(f"Errors ({len(errors)}):")
        print("-" * 70)
        for i, error in enumerate(errors, 1):
            print(f"  {i}. {error}")
        print()

    if warnings:
        print(f"Warnings ({len(warnings)}):")
        print("-" * 70)
        for i, warning in enumerate(warnings, 1):
            print(f"  {i}. {warning}")
        print()

    if not errors and not warnings:
        print("No errors or warnings. This SVG is fully conformant!")
        print()


def main():
    parser = argparse.ArgumentParser(
        description="Validate SVG pictograms against the MediaFranca SVG Schema",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python validator.py examples/canonical.svg
  python validator.py --schema custom-schema.json my-pictogram.svg

Exit codes:
  0 - Validation successful (no errors)
  1 - Validation failed (errors found)
  2 - Invalid arguments or file not found
        """
    )
    parser.add_argument(
        'svg_file',
        type=Path,
        help='Path to the SVG file to validate'
    )
    parser.add_argument(
        '--schema',
        type=Path,
        help='Path to custom metadata.schema.json (optional)'
    )
    parser.add_argument(
        '--quiet',
        action='store_true',
        help='Only show errors, not warnings'
    )

    args = parser.parse_args()

    # Check file exists
    if not args.svg_file.exists():
        print(f"Error: File not found: {args.svg_file}", file=sys.stderr)
        return 2

    # v2 has exactly one implementation: the portable Node validator used by
    # the browser too. Never approximate its result with the historical checks.
    try:
        source = args.svg_file.read_text(encoding='utf-8')
        if '<!DOCTYPE' in source.upper() or '<!ENTITY' in source.upper():
            raise ValueError('DTD/entities are forbidden')
        root = ET.fromstring(source)
        block = root.find('svg:metadata', NS)
        if block is None:
            block = root.find('metadata')
        metadata = json.loads(block.text) if block is not None else {}
        if metadata.get('schemaVersion') == '2.0.0-draft.1':
            if args.schema:
                raise ValueError('v2 uses its packaged canonical profile; custom schema override is forbidden')
            script = Path(__file__).parent.parent / 'scripts' / 'validate-svg.js'
            return subprocess.run(['node', str(script), str(args.svg_file.resolve())], check=False).returncode
    except Exception as error:
        print(f'Validation unavailable or invalid SVG: {error}', file=sys.stderr)
        return 1

    # Create validator
    validator = SVGValidator(args.svg_file, args.schema)

    # Run validation
    is_valid, errors, warnings = validator.validate()

    # Print results
    if args.quiet:
        warnings = []
    print_results(args.svg_file, is_valid, errors, warnings)

    # Return appropriate exit code
    return 0 if is_valid else 1


if __name__ == '__main__':
    sys.exit(main())
