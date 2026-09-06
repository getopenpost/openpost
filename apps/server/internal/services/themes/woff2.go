package themes

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"io"
	"strings"
	"unicode/utf16"

	"github.com/andybalholm/brotli"
	gofont "github.com/venusliang/go-font"
)

const maxDecodedThemeFontBytes = 16 * 1024 * 1024

var woff2KnownTags = [...]string{
	"cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post",
	"cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
	"EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea",
	"vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH",
	"CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar",
	"bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
	"gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop",
	"trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
}

type woff2Table struct {
	tag               string
	originalLength    uint32
	transformedLength uint32
	transformed       bool
}

func validateWOFF2(content []byte, expectedFamily string, expectedWeight int, expectedStyle string) error {
	tables, err := decodeWOFF2Tables(content)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidAsset, err)
	}
	return validateWOFF2Metadata(tables, expectedFamily, expectedWeight, expectedStyle)
}

func validateWOFF2Metadata(tables map[string][]byte, expectedFamily string, expectedWeight int, expectedStyle string) error {
	if _, variable := tables["fvar"]; variable {
		return fmt.Errorf("%w: variable WOFF2 faces are not portable to every supported mobile platform", ErrInvalidAsset)
	}
	return validateFontTableMetadata(tables, expectedFamily, expectedWeight, expectedStyle, "WOFF2")
}

type nativeFontDerivative struct {
	Content        []byte
	Format         string
	MediaType      string
	ChecksumSHA256 string
}

func prepareNativeFontDerivative(content []byte, expectedFamily string, expectedWeight int, expectedStyle string) (nativeFontDerivative, error) {
	if err := validateWOFF2(content, expectedFamily, expectedWeight, expectedStyle); err != nil {
		return nativeFontDerivative{}, err
	}
	serialized, err := convertWOFF2ToSFNT(content)
	if err != nil {
		return nativeFontDerivative{}, fmt.Errorf("%w: generate native font derivative: %v", ErrInvalidAsset, err)
	}
	format, mediaType := nativeSFNTFormat(serialized)
	if format == "" {
		return nativeFontDerivative{}, fmt.Errorf("%w: generated font derivative has an unsupported SFNT flavor", ErrInvalidAsset)
	}
	if err := validateSFNTDerivative(serialized, format, expectedFamily, expectedWeight, expectedStyle); err != nil {
		return nativeFontDerivative{}, err
	}
	checksum := sha256.Sum256(serialized)
	return nativeFontDerivative{
		Content: serialized, Format: format, MediaType: mediaType,
		ChecksumSHA256: hex.EncodeToString(checksum[:]),
	}, nil
}

func convertWOFF2ToSFNT(content []byte) (serialized []byte, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			serialized = nil
			err = fmt.Errorf("font converter rejected the input")
		}
	}()
	font, err := gofont.ParseWOFF2(content)
	if err != nil {
		return nil, err
	}
	serialized, err = font.Serialize()
	if err != nil {
		return nil, err
	}
	if len(serialized) == 0 || len(serialized) > maxDecodedThemeFontBytes {
		return nil, fmt.Errorf("generated SFNT exceeds the %d-byte limit", maxDecodedThemeFontBytes)
	}
	return serialized, nil
}

func nativeSFNTFormat(content []byte) (string, string) {
	if len(content) < 4 {
		return "", ""
	}
	switch string(content[:4]) {
	case "\x00\x01\x00\x00":
		return "ttf", "font/ttf"
	case "OTTO":
		return "otf", "font/otf"
	default:
		return "", ""
	}
}

func validateSFNTDerivative(content []byte, expectedFormat, expectedFamily string, expectedWeight int, expectedStyle string) error {
	if len(content) < 12 || len(content) > maxDecodedThemeFontBytes {
		return fmt.Errorf("%w: native font derivative size is invalid", ErrInvalidAsset)
	}
	format, _ := nativeSFNTFormat(content)
	if format == "" || format != expectedFormat {
		return fmt.Errorf("%w: native font derivative flavor does not match its format", ErrInvalidAsset)
	}
	tables, err := decodeSFNTTables(content)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidAsset, err)
	}
	if err := validateSFNTStructure(tables, format); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidAsset, err)
	}
	if format == "ttf" {
		if _, ok := tables["glyf"]; !ok {
			return fmt.Errorf("%w: TTF derivative is missing glyph outlines", ErrInvalidAsset)
		}
		if _, ok := tables["loca"]; !ok {
			return fmt.Errorf("%w: TTF derivative is missing glyph locations", ErrInvalidAsset)
		}
	} else if _, ok := tables["CFF "]; !ok {
		return fmt.Errorf("%w: OTF derivative is missing CFF outlines", ErrInvalidAsset)
	}
	if _, variable := tables["fvar"]; variable {
		return fmt.Errorf("%w: native font derivative remains variable", ErrInvalidAsset)
	}
	return validateFontTableMetadata(tables, expectedFamily, expectedWeight, expectedStyle, "native font derivative")
}

func validateSFNTStructure(tables map[string][]byte, format string) error {
	head, maxp, hhea := tables["head"], tables["maxp"], tables["hhea"]
	if len(head) < 54 || binary.BigEndian.Uint32(head[12:16]) != 0x5f0f3cf5 {
		return fmt.Errorf("native font derivative has an invalid head table")
	}
	unitsPerEm := binary.BigEndian.Uint16(head[18:20])
	if unitsPerEm < 16 || unitsPerEm > 16384 {
		return fmt.Errorf("native font derivative units per em are invalid")
	}
	if len(maxp) < 6 || len(hhea) < 36 {
		return fmt.Errorf("native font derivative is missing bounded glyph metrics")
	}
	numGlyphs := int(binary.BigEndian.Uint16(maxp[4:6]))
	numMetrics := int(binary.BigEndian.Uint16(hhea[34:36]))
	if numGlyphs < 1 || numMetrics < 1 || numMetrics > numGlyphs || len(tables["hmtx"]) < numMetrics*4 {
		return fmt.Errorf("native font derivative glyph metrics are invalid")
	}
	if !validSFNTCmap(tables["cmap"]) {
		return fmt.Errorf("native font derivative character map is invalid")
	}
	if format == "ttf" && !validTTFOutlines(tables, head, numGlyphs) {
		return fmt.Errorf("TTF derivative glyph outlines are invalid")
	}
	return nil
}

func validTTFOutlines(tables map[string][]byte, head []byte, numGlyphs int) bool {
	locationSize := 2
	if binary.BigEndian.Uint16(head[50:52]) == 1 {
		locationSize = 4
	}
	return len(tables["glyf"]) > 0 && len(tables["loca"]) >= (numGlyphs+1)*locationSize
}

func validSFNTCmap(table []byte) bool {
	if len(table) < 4 || binary.BigEndian.Uint16(table[:2]) != 0 {
		return false
	}
	count := int(binary.BigEndian.Uint16(table[2:4]))
	if count < 1 || 4+count*8 > len(table) {
		return false
	}
	for index := 0; index < count; index++ {
		record := table[4+index*8 : 12+index*8]
		platform := binary.BigEndian.Uint16(record[:2])
		offset := int(binary.BigEndian.Uint32(record[4:8]))
		if (platform != 0 && platform != 3) || offset < 4+count*8 || offset+4 > len(table) {
			continue
		}
		subtable := table[offset:]
		format := binary.BigEndian.Uint16(subtable[:2])
		var length int
		switch format {
		case 0, 2, 4, 6:
			length = int(binary.BigEndian.Uint16(subtable[2:4]))
		case 10, 12, 13:
			if len(subtable) < 8 {
				continue
			}
			length = int(binary.BigEndian.Uint32(subtable[4:8]))
		default:
			continue
		}
		if length >= 4 && length <= len(subtable) {
			return true
		}
	}
	return false
}

func decodeSFNTTables(content []byte) (map[string][]byte, error) {
	numTables := int(binary.BigEndian.Uint16(content[4:6]))
	directoryEnd := 12 + numTables*16
	if numTables < 1 || numTables > 255 || directoryEnd > len(content) {
		return nil, fmt.Errorf("native font derivative table directory is invalid")
	}
	tables := make(map[string][]byte, numTables)
	for index := 0; index < numTables; index++ {
		record := content[12+index*16 : 28+index*16]
		tag := string(record[:4])
		offset := uint64(binary.BigEndian.Uint32(record[8:12]))
		length := uint64(binary.BigEndian.Uint32(record[12:16]))
		end := offset + length
		if _, duplicate := tables[tag]; duplicate || offset%4 != 0 || offset < uint64(directoryEnd) || end < offset || end > uint64(len(content)) {
			return nil, fmt.Errorf("native font derivative contains an invalid table")
		}
		tables[tag] = content[int(offset):int(end)]
	}
	return tables, nil
}

func validateFontTableMetadata(tables map[string][]byte, expectedFamily string, expectedWeight int, expectedStyle, label string) error {
	family, ok := woff2Family(tables["name"])
	if !ok || !strings.EqualFold(strings.TrimSpace(family), strings.TrimSpace(expectedFamily)) {
		return fmt.Errorf("%w: %s family metadata does not match the declared family", ErrInvalidAsset, label)
	}
	os2 := tables["OS/2"]
	if len(os2) < 64 {
		return fmt.Errorf("%w: %s is missing complete OS/2 metadata", ErrInvalidAsset, label)
	}
	weight := int(binary.BigEndian.Uint16(os2[4:6]))
	if weight != expectedWeight {
		return fmt.Errorf("%w: %s weight metadata does not match the declared weight", ErrInvalidAsset, label)
	}
	italic := binary.BigEndian.Uint16(os2[62:64])&1 != 0
	if (expectedStyle == "italic") != italic {
		return fmt.Errorf("%w: %s style metadata does not match the declared style", ErrInvalidAsset, label)
	}
	return nil
}

//nolint:gocyclo // The binary parser keeps every WOFF2 structural and decompression-bomb check visible at one trust boundary.
func decodeWOFF2Tables(content []byte) (map[string][]byte, error) {
	if len(content) < 48 || string(content[:4]) != "wOF2" {
		return nil, fmt.Errorf("font is not a WOFF2 file")
	}
	if declared := binary.BigEndian.Uint32(content[8:12]); uint64(declared) != uint64(len(content)) {
		return nil, fmt.Errorf("WOFF2 declared length does not match upload")
	}
	numTables := int(binary.BigEndian.Uint16(content[12:14]))
	if numTables < 1 || numTables > 255 || binary.BigEndian.Uint16(content[14:16]) != 0 {
		return nil, fmt.Errorf("WOFF2 table directory header is invalid")
	}
	totalSFNTSize := uint64(binary.BigEndian.Uint32(content[16:20]))
	compressedSize := uint64(binary.BigEndian.Uint32(content[20:24]))
	minimumSFNTSize := uint64(12 + 16*numTables)
	if totalSFNTSize < minimumSFNTSize || totalSFNTSize > maxDecodedThemeFontBytes || compressedSize == 0 {
		return nil, fmt.Errorf("WOFF2 decoded size is invalid")
	}
	if err := validateWOFF2OptionalSections(content); err != nil {
		return nil, err
	}

	offset := 48
	directory := make([]woff2Table, 0, numTables)
	seen := make(map[string]struct{}, numTables)
	var decodedLength uint64
	expectedSFNTSize := minimumSFNTSize
	for range numTables {
		if offset >= len(content) {
			return nil, fmt.Errorf("WOFF2 table directory is truncated")
		}
		flags := content[offset]
		offset++
		tagIndex := flags & 0x3f
		var tag string
		if tagIndex == 0x3f {
			if offset+4 > len(content) {
				return nil, fmt.Errorf("WOFF2 custom table tag is truncated")
			}
			tag = string(content[offset : offset+4])
			offset += 4
		} else {
			tag = woff2KnownTags[tagIndex]
		}
		if _, duplicate := seen[tag]; duplicate {
			return nil, fmt.Errorf("WOFF2 contains a duplicate table")
		}
		seen[tag] = struct{}{}
		originalLength, next, ok := readUIntBase128(content, offset)
		if !ok || originalLength == 0 {
			return nil, fmt.Errorf("WOFF2 table length is invalid")
		}
		offset = next
		transformVersion := flags >> 6
		transformed, valid := validWOFF2Transform(tag, transformVersion)
		if !valid {
			return nil, fmt.Errorf("WOFF2 table transform is unsupported")
		}
		transformedLength := originalLength
		if transformed {
			transformedLength, offset, ok = readUIntBase128(content, offset)
			if !ok || (tag != "loca" && transformedLength == 0) || (tag == "loca" && transformedLength != 0) {
				return nil, fmt.Errorf("WOFF2 transformed table length is invalid")
			}
		}
		decodedLength += uint64(transformedLength)
		if decodedLength > totalSFNTSize || decodedLength > maxDecodedThemeFontBytes {
			return nil, fmt.Errorf("WOFF2 table data exceeds its decoded size")
		}
		expectedSFNTSize += (uint64(originalLength) + 3) &^ 3
		if expectedSFNTSize > maxDecodedThemeFontBytes {
			return nil, fmt.Errorf("WOFF2 original tables exceed the decoded size limit")
		}
		directory = append(directory, woff2Table{tag: tag, originalLength: originalLength, transformedLength: transformedLength, transformed: transformed})
	}
	if expectedSFNTSize != totalSFNTSize {
		return nil, fmt.Errorf("WOFF2 declared SFNT size does not match its table directory")
	}
	if compressedSize > uint64(len(content)-offset) {
		return nil, fmt.Errorf("WOFF2 compressed payload is truncated")
	}
	compressedEnd := offset + int(compressedSize)
	if !woff2PaddingOnlyBeforeOptionalSections(content, compressedEnd) {
		return nil, fmt.Errorf("WOFF2 contains invalid data after its compressed payload")
	}
	decoded, err := io.ReadAll(io.LimitReader(brotli.NewReader(bytes.NewReader(content[offset:compressedEnd])), int64(decodedLength)+1))
	if err != nil || uint64(len(decoded)) != decodedLength {
		return nil, fmt.Errorf("WOFF2 compressed table data is invalid")
	}

	tables := make(map[string][]byte, numTables)
	offset = 0
	for _, table := range directory {
		end := offset + int(table.transformedLength)
		if end > len(decoded) {
			return nil, fmt.Errorf("WOFF2 decoded table data is truncated")
		}
		if !table.transformed {
			tables[table.tag] = decoded[offset:end]
		}
		offset = end
	}
	return tables, nil
}

func validWOFF2Transform(tag string, version byte) (bool, bool) {
	switch tag {
	case "glyf", "loca":
		return version == 0, version == 0 || version == 3
	case "hmtx":
		return version == 1, version == 0 || version == 1
	default:
		return false, version == 0
	}
}

func readUIntBase128(content []byte, offset int) (uint32, int, bool) {
	var result uint32
	for index := 0; index < 5; index++ {
		if offset >= len(content) {
			return 0, offset, false
		}
		value := content[offset]
		offset++
		if index == 0 && value == 0x80 {
			return 0, offset, false
		}
		if result&0xfe000000 != 0 {
			return 0, offset, false
		}
		result = result<<7 | uint32(value&0x7f)
		if value&0x80 == 0 {
			return result, offset, true
		}
	}
	return 0, offset, false
}

func validateWOFF2OptionalSections(content []byte) error {
	sections := []struct {
		offset uint32
		length uint32
		other  uint32
	}{
		{binary.BigEndian.Uint32(content[28:32]), binary.BigEndian.Uint32(content[32:36]), binary.BigEndian.Uint32(content[36:40])},
		{binary.BigEndian.Uint32(content[40:44]), binary.BigEndian.Uint32(content[44:48]), 0},
	}
	for index, section := range sections {
		if section.offset == 0 {
			if section.length != 0 || section.other != 0 {
				return fmt.Errorf("WOFF2 optional section header is inconsistent")
			}
			continue
		}
		end := uint64(section.offset) + uint64(section.length)
		if section.length == 0 || end > uint64(len(content)) || (index == 0 && (section.other == 0 || section.other > maxDecodedThemeFontBytes)) {
			return fmt.Errorf("WOFF2 optional section is invalid")
		}
	}
	return nil
}

func woff2PaddingOnlyBeforeOptionalSections(content []byte, compressedEnd int) bool {
	firstOptional := len(content)
	for _, field := range []int{28, 40} {
		if offset := int(binary.BigEndian.Uint32(content[field : field+4])); offset > 0 && offset < firstOptional {
			firstOptional = offset
		}
	}
	if compressedEnd > firstOptional {
		return false
	}
	for _, value := range content[compressedEnd:firstOptional] {
		if value != 0 {
			return false
		}
	}
	return true
}

//nolint:gocyclo // Name-table decoding exhaustively handles bounded platform encodings and preferred family records.
func woff2Family(table []byte) (string, bool) {
	if len(table) < 6 {
		return "", false
	}
	count := int(binary.BigEndian.Uint16(table[2:4]))
	stringsOffset := int(binary.BigEndian.Uint16(table[4:6]))
	if count < 1 || 6+count*12 > len(table) || stringsOffset > len(table) {
		return "", false
	}
	for _, wantedID := range []uint16{16, 1} {
		for index := 0; index < count; index++ {
			record := table[6+index*12 : 18+index*12]
			platformID := binary.BigEndian.Uint16(record[0:2])
			nameID := binary.BigEndian.Uint16(record[6:8])
			length := int(binary.BigEndian.Uint16(record[8:10]))
			offset := stringsOffset + int(binary.BigEndian.Uint16(record[10:12]))
			if nameID != wantedID || (platformID != 0 && platformID != 3) || length == 0 || length%2 != 0 || offset < stringsOffset || offset+length > len(table) {
				continue
			}
			units := make([]uint16, length/2)
			for unit := range units {
				units[unit] = binary.BigEndian.Uint16(table[offset+unit*2 : offset+unit*2+2])
			}
			family := strings.TrimSpace(string(utf16.Decode(units)))
			if family != "" {
				return family, true
			}
		}
	}
	return "", false
}
