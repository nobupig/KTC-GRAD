export function getBaseColumns() {
  return [
    { key: "studentId", label: "学籍番号", align: "center", width: 110 },
    { key: "grade", label: "学年", align: "center", width: 60 },
    { key: "class", label: "組・コース", align: "center", width: 80 },
    { key: "number", label: "番号", align: "center", width: 60 },
    { key: "name", label: "氏名", align: "center", minWidth: 120 },
  ];
}
