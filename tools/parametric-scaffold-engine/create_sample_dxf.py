"""Create a minimal sample DXF with a closed building perimeter (rectangle 10m x 8m)."""
import ezdxf

doc = ezdxf.new("R2000")
# Use meters so engine's scale_to_mm (1000) gives 10000mm x 8000mm
doc.header["$INSUNITS"] = 6  # 6 = meters
msp = doc.modelspace()
msp.add_lwpolyline([(0, 0), (10, 0), (10, 8), (0, 8)], close=True)
doc.saveas("sample_building.dxf")
print("Created sample_building.dxf (10m x 8m rectangle)")
