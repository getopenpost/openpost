// Package ico decodes ICO files through seekable byte inputs.
package ico

import (
	"bytes"
	"image"

	"github.com/openpost/backend/internal/mediacodec/ico/internal/icondir"
)

// FormatError reports that the input is not a valid ICO.
type FormatError string

func (e FormatError) Error() string { return "ico: invalid format: " + string(e) }

// UnsupportedError reports that the input uses a valid but unimplemented ICO feature.
type UnsupportedError string

func (e UnsupportedError) Error() string { return "ico: unsupported feature: " + string(e) }

// Decode reads an ICO image from content and returns the largest stored icon
// as an image.Image.
func Decode(content []byte) (image.Image, error) {
	d := icondir.NewDecoder(bytes.NewReader(content), true)
	if err := d.DecodeDir(); err != nil {
		return nil, convertErr(err)
	}
	e, err := d.Best()
	if err != nil {
		return nil, convertErr(err)
	}
	m, err := d.Decode(e)
	if err != nil {
		return nil, convertErr(err)
	}
	return m, nil
}

// DecodeConfig returns the color model and dimensions of the largest icon
// stored in an ICO image without decoding the entire icon.
func DecodeConfig(content []byte) (image.Config, error) {
	d := icondir.NewDecoder(bytes.NewReader(content), true)
	if err := d.DecodeDir(); err != nil {
		return image.Config{}, convertErr(err)
	}
	m, err := d.Best()
	if err != nil {
		return image.Config{}, convertErr(err)
	}
	config, err := d.DecodeConfig(m)
	if err != nil {
		return image.Config{}, convertErr(err)
	}
	return config, nil
}

func convertErr(err error) error {
	switch err.(type) {
	case icondir.FormatError:
		return FormatError(err.Error())
	case icondir.UnsupportedError:
		return UnsupportedError(err.Error())
	default:
		return err
	}
}
