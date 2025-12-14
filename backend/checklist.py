def generate_checklist(bom_items):
    checklist = []

    for item in bom_items:
        checklist.append({
            "FIND NUMBER": item["find_number"],
            "PART DESCRIPTION": item["part_description"],
            "STATUS": "",          # OK / NOT OK (User)
            "REMARKS": ""          # User input
        })

    return checklist

